import { enableMapSet } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ModelGeometry } from '../core/modeling.js';
import { DEFAULT_WALL_THICKNESS, MODEL_SCHEMA_ID } from '../core/modeling.js';
import type { RoomPolygon, WallSegment } from '../core/modeling.js';
import { UndoStack, applyUserEdit } from '../core/confidence.js';
import { HOUSE_TEMPLATES, getTemplate } from '../core/templates.js';
import { useProjectStore } from './projectStore.js';

enableMapSet();

// ---------------------------------------------------------------------------
// 模块级 UndoStack（不进 zustand state，避免被 immer draft 化）
// ---------------------------------------------------------------------------

const undoStack = new UndoStack<ModelGeometry>();

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

  applyTemplate: (id: string) => void;
  clearModel: () => void;
  addPendingVertex: (vertex: [number, number]) => void;
  cancelPending: () => void;
  commitRoom: (roomName: string) => void;
  setGridSnap: (v: boolean) => void;
  setOrthoSnap: (v: boolean) => void;
  startDrawing: () => void;
  stopDrawing: () => void;
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

    applyTemplate: (id) => {
      const t = getTemplate(id);
      if (t === undefined) return;
      const prev = get().model;
      const next = structuredClone(t.model);
      undoStack.push({
        elementId: id,
        label: '应用模板',
        before: structuredClone(prev),
        after: structuredClone(next),
      });
      set({ selectedTemplateId: id, model: next, pendingVertices: [] });
      syncToProjectStore();
    },

    clearModel: () => {
      const prev = get().model;
      const next = emptyModel();
      undoStack.push({
        elementId: '__clear__',
        label: '清空模型',
        before: structuredClone(prev),
        after: structuredClone(next),
      });
      set({ selectedTemplateId: null, model: next, pendingVertices: [] });
      syncToProjectStore();
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
      const prev = get().model;

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

      undoStack.push({
        elementId: roomId,
        label: `描墙: ${roomName}`,
        before: structuredClone(prev),
        after: structuredClone(next),
      });
      set({ model: next, pendingVertices: [], isDrawing: false });
      syncToProjectStore();
    },

    setGridSnap: (v) => set({ gridSnap: v }),
    setOrthoSnap: (v) => set({ orthoSnap: v }),
    startDrawing: () => set({ isDrawing: true }),
    stopDrawing: () => set({ isDrawing: false }),

    undo: () => {
      const entry = undoStack.undo();
      if (entry === null) return;
      set({
        model: structuredClone(entry.before),
        selectedTemplateId: findTemplateId(entry.before),
      });
      syncToProjectStore();
    },

    redo: () => {
      const entry = undoStack.redo();
      if (entry === null) return;
      set({
        model: structuredClone(entry.after),
        selectedTemplateId: findTemplateId(entry.after),
      });
      syncToProjectStore();
    },

    canUndo: () => undoStack.canUndo(),
    canRedo: () => undoStack.canRedo(),
  })),
);

export { HOUSE_TEMPLATES, emptyModel, undoStack };
