import { enableMapSet } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ModelGeometry } from '../core/modeling.js';
import { DEFAULT_WALL_THICKNESS, MODEL_SCHEMA_ID } from '../core/modeling.js';
import type { RoomPolygon, WallSegment } from '../core/modeling.js';
import { applyUserEdit } from '../core/confidence.js';
import { HOUSE_TEMPLATES, getTemplate } from '../core/templates.js';
import { calibrate, confirmScale } from '../core/scale.js';
import type { LengthUnit } from '../core/scale.js';
import { useProjectStore } from './projectStore.js';
import { pushCommand, undoCommand, redoCommand, commandStack } from './commandBus.js';

enableMapSet();

// ---------------------------------------------------------------------------
// 空画布（描墙起点）
// ---------------------------------------------------------------------------

function emptyModel(): ModelGeometry {
  return {
    schemaId: MODEL_SCHEMA_ID,
    walls: [],
    openings: [],
    rooms: [],
    slab: { level: 0, thickness: DEFAULT_WALL_THICKNESS, ceilingH: 2.8 },
    calibration: null,
    track: { track: 'scan', guaranteesUniformError: false },
  };
}

// ---------------------------------------------------------------------------
// 描墙提交：首末闭合 → 生成 RoomPolygon + 外墙段 → applyUserEdit → undo 栈
// ---------------------------------------------------------------------------

function verticesToRoomPolygon(vertices: readonly (readonly [number, number])[], roomId: string, roomName: string): RoomPolygon {
  const base: RoomPolygon = {
    id: roomId,
    name: roomName,
    vertices: vertices.map((v) => [...v] as [number, number]),
    confidence: 0.5,
    provenance: { kind: 'model_inferred', rule: 'user_drawn' },
  };
  return applyUserEdit(base);
}

function verticesToWalls(vertices: readonly (readonly [number, number])[], wallIdPrefix: string): WallSegment[] {
  const walls: WallSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const p1 = vertices[i]!;
    const p2 = vertices[i + 1]!;
    const base: WallSegment = {
      id: `${wallIdPrefix}${i}`,
      a: [...p1] as [number, number],
      b: [...p2] as [number, number],
      thickness: DEFAULT_WALL_THICKNESS,
      height: 2.8,
      confidence: 0.5,
      provenance: { kind: 'model_inferred', rule: 'user_drawn' },
    };
    walls.push(applyUserEdit(base));
  }
  return walls;
}

// ---------------------------------------------------------------------------
// store 状态形状
// ---------------------------------------------------------------------------

interface ModelingState {
  selectedTemplateId: string | null;
  model: ModelGeometry;
  pendingVertices: readonly [number, number][];
  pendingRoomName: string;
  gridSnap: boolean;
  orthoSnap: boolean;
  isDrawing: boolean;

  // P23：上传与标定
  importedImage: ImageBitmap | null;
  importImageName: string | null;
  calibrationPoints: [number, number][];
  isCalibrating: boolean;
  calibrationError: string | null;

  applyTemplate: (id: string) => void;
  clearModel: () => void;
  addPendingVertex: (vertex: [number, number]) => void;
  cancelPending: () => void;
  commitRoom: (roomName: string) => void;
  setGridSnap: (v: boolean) => void;
  setOrthoSnap: (v: boolean) => void;
  startDrawing: () => void;
  stopDrawing: () => void;
  importImage: (file: File) => void;
  clearImport: () => void;
  addCalibrationPoint: (x: number, y: number) => void;
  confirmCalibration: (realDistance: number, unit: LengthUnit) => void;
  resetCalibration: () => void;
  applyExtractResult: (model: ModelGeometry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// ---------------------------------------------------------------------------
// 跨 store 同步
// ---------------------------------------------------------------------------

function syncToProjectStore(): void {
  const { model } = useModelingStore.getState();
  const project = useProjectStore.getState().project;
  useProjectStore.setState({ project: { ...project, model } });
}

// ---------------------------------------------------------------------------
// 判断 model 是否匹配某个模板（用于恢复 selectedTemplateId）
// ---------------------------------------------------------------------------

function findTemplateId(model: ModelGeometry): string | null {
  for (const t of HOUSE_TEMPLATES) {
    if (t.model.rooms.length === model.rooms.length && t.model.walls.length === model.walls.length) {
      // 简单比较：房间名和数量一致即视为匹配
      const templateNames = t.model.rooms.map((r) => r.name).sort().join(',');
      const modelNames = model.rooms.map((r) => r.name).sort().join(',');
      if (templateNames === modelNames) return t.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// store 实现
// ---------------------------------------------------------------------------

export const useModelingStore = create<ModelingState>()(
  immer((set, get) => ({
    selectedTemplateId: null,
    model: emptyModel(),
    pendingVertices: [],
    pendingRoomName: '房间',
    gridSnap: true,
    orthoSnap: true,
    isDrawing: false,
    importedImage: null,
    importImageName: null,
    calibrationPoints: [],
    isCalibrating: false,
    calibrationError: null,

    applyTemplate: (id) => {
      const t = getTemplate(id);
      if (t === undefined) return;
      const prev = structuredClone(get().model);
      const next = structuredClone(t.model);
      pushCommand({
        label: '应用模板',
        execute: () => {
          set({ selectedTemplateId: id, model: next, pendingVertices: [] });
          syncToProjectStore();
        },
        undo: () => {
          // 与旧 UndoStack 语义一致：只还原 model，selectedTemplateId 由 findTemplateId 反推
          set({ selectedTemplateId: findTemplateId(prev), model: prev });
          syncToProjectStore();
        },
      });
    },

    clearModel: () => {
      const prev = structuredClone(get().model);
      const next = emptyModel();
      pushCommand({
        label: '清空模型',
        execute: () => {
          set({ selectedTemplateId: null, model: next, pendingVertices: [] });
          syncToProjectStore();
        },
        undo: () => {
          // 与旧 UndoStack 语义一致：只还原 model，selectedTemplateId 由 findTemplateId 反推
          set({ selectedTemplateId: findTemplateId(prev), model: prev });
          syncToProjectStore();
        },
      });
    },

    addPendingVertex: (vertex) => {
      set((s) => {
        s.pendingVertices = [...s.pendingVertices, vertex];
      });
    },

    cancelPending: () => {
      set({ pendingVertices: [], isDrawing: false });
    },

    commitRoom: (roomName) => {
      const { pendingVertices } = get();
      if (pendingVertices.length < 3) return;
      const prev = structuredClone(get().model);

      // 首末闭合
      let vertices = pendingVertices;
      if (vertices[0]![0] !== vertices[vertices.length - 1]![0] || vertices[0]![1] !== vertices[vertices.length - 1]![1]) {
        vertices = [...vertices, vertices[0]!];
      }

      const roomId = `user_r${Date.now()}`;
      const room = verticesToRoomPolygon(vertices, roomId, roomName);
      const walls = verticesToWalls(vertices, `user_w${Date.now()}_`);

      const next = structuredClone(prev);
      next.rooms = [...next.rooms, room];
      next.walls = [...next.walls, ...walls];
      next.track = { track: 'scan', guaranteesUniformError: false };

      pushCommand({
        label: `描墙: ${roomName}`,
        execute: () => {
          set({ model: next, pendingVertices: [], isDrawing: false });
          syncToProjectStore();
        },
        undo: () => {
          // 与旧 UndoStack 语义一致：只还原 model
          set({ model: prev });
          syncToProjectStore();
        },
      });
    },

    setGridSnap: (v) => set({ gridSnap: v }),
    setOrthoSnap: (v) => set({ orthoSnap: v }),
    startDrawing: () => set({ isDrawing: true }),
    stopDrawing: () => set({ isDrawing: false }),

    importImage: (file) => {
      void file.arrayBuffer().then((buf) => {
        return createImageBitmap(new Blob([buf]));
      }).then((bitmap) => {
        set({ importedImage: bitmap, importImageName: file.name, calibrationPoints: [], isCalibrating: true, calibrationError: null });
      }).catch((err) => {
        set({ calibrationError: `图片加载失败: ${err instanceof Error ? err.message : String(err)}` });
      });
    },

    clearImport: () => {
      const prev = structuredClone(get().model);
      const next = emptyModel();
      pushCommand({
        label: '清空导入',
        execute: () => {
          set({
            importedImage: null,
            importImageName: null,
            calibrationPoints: [],
            isCalibrating: false,
            calibrationError: null,
            selectedTemplateId: null,
            model: next,
            pendingVertices: [],
            isDrawing: false,
          });
          syncToProjectStore();
        },
        undo: () => {
          // 与旧 UndoStack 语义一致：只还原 model，不动 importedImage 等其他字段
          set({ selectedTemplateId: findTemplateId(prev), model: prev });
          syncToProjectStore();
        },
      });
    },

    addCalibrationPoint: (x, y) => {
      set((s) => {
        if (s.calibrationPoints.length < 2) {
          s.calibrationPoints = [...s.calibrationPoints, [x, y]];
        }
      });
    },

    confirmCalibration: (realDistance, unit) => {
      const { calibrationPoints } = get();
      if (calibrationPoints.length < 2) return;
      const p1 = calibrationPoints[0]!;
      const p2 = calibrationPoints[1]!;
      const measuredPx = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);

      let result: ReturnType<typeof calibrate>;
      try {
        result = calibrate(measuredPx, realDistance, unit);
      } catch (e) {
        set({ calibrationError: e instanceof Error ? e.message : '标定失败' });
        return;
      }

      const ok = confirmScale(result);
      if (!ok) {
        set({ calibrationError: '标定距离超出合理范围（0.01m–100m）' });
        return;
      }

      // 标定成功：挂到 model.calibration
      const next = structuredClone(get().model);
      next.calibration = result;
      next.track = { track: 'scan', guaranteesUniformError: false };
      set({
        model: next,
        isCalibrating: false,
        calibrationError: null,
      });
      syncToProjectStore();
    },

    resetCalibration: () => {
      set({ calibrationPoints: [], calibrationError: null });
    },

    applyExtractResult: (model) => {
      set({ model, selectedTemplateId: null, isCalibrating: false });
      syncToProjectStore();
    },

    undo: () => {
      undoCommand();
    },

    redo: () => {
      redoCommand();
    },

    canUndo: () => commandStack.canUndo(),
    canRedo: () => commandStack.canRedo(),
  })),
);

export { HOUSE_TEMPLATES, emptyModel };
