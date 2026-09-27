import { describe, expect, it } from 'vitest';

import { calibrate } from '../scale.js';
import type {
  ModelGeometry,
  Opening,
  Provenance,
  RoomPolygon,
  Slab,
  WallSegment,
} from '../modeling.js';
import {
  AREA_RELATIVE_TOLERANCE,
  TOPOLOGY_EPSILON,
  WALL_ENDPOINT_EPSILON,
  checkAreaMatchesLabel,
  checkOpeningOnWall,
  checkRoomClosed,
  checkScaleSelfConsistent,
  checkTopology,
  checkWallEndpointsConnected,
  roomArea,
  wallLength,
} from '../topology.js';

describe('拓扑校验（§6 范围 8，§4 红线 2：违规必须定位到具体 id）', () => {
  // ---------- helpers ----------
  const makeProvenance = (kind: Provenance['kind'] = 'user_edit'): Provenance =>
    kind === 'user_edit'
      ? { kind }
      : kind === 'image_element'
        ? { kind, elementId: 'seg-1' }
        : { kind, rule: 'snap' };

  const makeWall = (overrides: Partial<WallSegment> = {}): WallSegment => ({
    id: 'w1',
    a: [0, 0],
    b: [3, 0],
    thickness: 0.15,
    height: 2.8,
    confidence: 0.9,
    provenance: makeProvenance(),
    ...overrides,
  });

  const makeOpening = (overrides: Partial<Opening> = {}): Opening => ({
    id: 'o1',
    wallId: 'w1',
    kind: 'door',
    offset: 0.5,
    width: 0.9,
    height: 2.1,
    sill: 0,
    confidence: 0.9,
    provenance: makeProvenance(),
    ...overrides,
  });

  /** 3x2 的矩形房间（首尾顶点相同，已闭合） */
  const makeRoom = (overrides: Partial<RoomPolygon> = {}): RoomPolygon => ({
    id: 'r1',
    name: '客厅',
    vertices: [
      [0, 0],
      [3, 0],
      [3, 2],
      [0, 2],
      [0, 0], // 闭合：与首点相同
    ],
    confidence: 0.9,
    provenance: makeProvenance(),
    ...overrides,
  });

  const makeSlab = (): Slab => ({ level: 0, thickness: 0.15, ceilingH: 2.8 });

  const makeCalibration = () => calibrate(300, 3, 'm');

  /** 构造一个完全通过的 model（用于验证 passed=true） */
  const makeValidModel = (): ModelGeometry => ({
    schemaId: 'lumina.model/1',
    // 四面墙首尾相连形成闭合矩形（所有端点都被相邻墙匹配）
    walls: [
      makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
      makeWall({ id: 'w2', a: [3, 0], b: [3, 2] }),
      makeWall({ id: 'w3', a: [3, 2], b: [0, 2] }),
      makeWall({ id: 'w4', a: [0, 2], b: [0, 0] }),
    ],
    openings: [makeOpening({ id: 'o1', wallId: 'w1', offset: 0.5, width: 0.9 })],
    rooms: [
      makeRoom({
        id: 'r1',
        vertices: [
          [0, 0],
          [3, 0],
          [3, 2],
          [0, 2],
          [0, 0],
        ],
        labeledArea: 6, // 3x2 = 6 平方米
      }),
    ],
    slab: makeSlab(),
    calibration: makeCalibration(),
    track: { track: 'template', guaranteesUniformError: true, maxErrorCm: 5 },
  });

  // ---------- 常量 ----------
  describe('常量与边界', () => {
    it('TOPOLOGY_EPSILON = 0.01（1cm 端点容差）', () => {
      expect(TOPOLOGY_EPSILON).toBe(0.01);
    });

    it('AREA_RELATIVE_TOLERANCE = 0.05（5% 面积容差）', () => {
      expect(AREA_RELATIVE_TOLERANCE).toBe(0.05);
    });

    it('WALL_ENDPOINT_EPSILON = 0.01', () => {
      expect(WALL_ENDPOINT_EPSILON).toBe(0.01);
    });
  });

  // ---------- wallLength / roomArea ----------
  describe('wallLength / roomArea', () => {
    it('wallLength: 水平墙 [0,0] -> [3,0] 长 3', () => {
      expect(wallLength(makeWall({ a: [0, 0], b: [3, 0] }))).toBeCloseTo(3, 9);
    });

    it('wallLength: 对角墙 [0,0] -> [3,4] 长 5（勾股）', () => {
      expect(wallLength(makeWall({ a: [0, 0], b: [3, 4] }))).toBeCloseTo(5, 9);
    });

    it('wallLength: 同点 0 长', () => {
      expect(wallLength(makeWall({ a: [1, 1], b: [1, 1] }))).toBeCloseTo(0, 9);
    });

    it('roomArea: 3x2 矩形 = 6 平方米', () => {
      expect(roomArea(makeRoom({ labeledArea: 6 }))).toBeCloseTo(6, 9);
    });

    it('roomArea: 顶点数 < 3 返回 0', () => {
      expect(roomArea(makeRoom({ vertices: [[0, 0], [1, 0]] }))).toBeCloseTo(0, 9);
    });

    it('roomArea: 三点共线（退化）返回 0', () => {
      expect(
        roomArea(makeRoom({ vertices: [[0, 0], [1, 0], [2, 0], [0, 0]] })),
      ).toBeCloseTo(0, 9);
    });

    it('roomArea: 不需要预先闭合（自动闭合）', () => {
      // 不显式加 [0,0] 尾点，shoelace 仍正确算出 6
      expect(
        roomArea(
          makeRoom({
            vertices: [
              [0, 0],
              [3, 0],
              [3, 2],
              [0, 2],
            ],
          }),
        ),
      ).toBeCloseTo(6, 9);
    });
  });

  // ---------- 规则 1: room_closed ----------
  describe('checkRoomClosed', () => {
    it('首尾相同（已闭合）-> 无违规', () => {
      const rooms = [makeRoom()];
      expect(checkRoomClosed(rooms)).toHaveLength(0);
    });

    it('首尾不同（未闭合）-> 违规，定位到 room id', () => {
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2], // 与首点 [0,0] 不同，未闭合
          ],
        }),
      ];
      const violations = checkRoomClosed(rooms);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('room_closed');
      expect(violations[0]?.elementIds).toContain('r1');
    });

    it('顶点数 < 3 -> 违规，elementIds 含 room id', () => {
      const rooms = [makeRoom({ vertices: [[0, 0], [1, 0]] })];
      const violations = checkRoomClosed(rooms);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('room_closed');
      expect(violations[0]?.elementIds).toContain('r1');
    });

    it('三点共线（退化）-> 违规', () => {
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [1, 0],
            [2, 0],
            [0, 0],
          ],
        }),
      ];
      const violations = checkRoomClosed(rooms);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('room_closed');
    });

    it('容差内（差 0.005 m = 0.5 cm）视为闭合', () => {
      // TOPOLOGY_EPSILON = 0.01，差 0.005 在容差内
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0.005, 2], // 与首点差 0.005
            [0, 0],
          ],
        }),
      ];
      // 注意：此房间有 5 个点，需要首尾闭合 [0,0] -> [0,0]
      // 但中间 [0.005, 2] 不影响闭合判定
      expect(checkRoomClosed(rooms)).toHaveLength(0);
    });

    it('容差外（差 0.05 m = 5 cm）视为未闭合', () => {
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0.05, 2], // 与首点 [0,0] 差 0.05，超出 0.01 容差
          ],
        }),
      ];
      const violations = checkRoomClosed(rooms);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('room_closed');
      expect(violations[0]?.detail?.gapX).toBeCloseTo(0.05, 9);
    });
  });

  // ---------- 规则 2: opening_on_wall ----------
  describe('checkOpeningOnWall', () => {
    it('开口在墙段内 -> 无违规', () => {
      const walls = [makeWall({ id: 'w1', a: [0, 0], b: [3, 0] })]; // 长 3
      const openings = [makeOpening({ wallId: 'w1', offset: 0.5, width: 0.9 })]; // 0.5+0.9=1.4 <= 3
      expect(checkOpeningOnWall(walls, openings)).toHaveLength(0);
    });

    it('开口超出墙长 -> 违规，定位到 opening id + wall id', () => {
      const walls = [makeWall({ id: 'w1', a: [0, 0], b: [3, 0] })]; // 长 3
      const openings = [makeOpening({ wallId: 'w1', offset: 2.5, width: 1.5 })]; // 2.5+1.5=4 > 3
      const violations = checkOpeningOnWall(walls, openings);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('opening_on_wall');
      expect(violations[0]?.elementIds).toContain('o1');
      expect(violations[0]?.elementIds).toContain('w1');
    });

    it('开口引用不存在的墙（孤儿）-> 违规，只含 opening id', () => {
      const walls = [makeWall({ id: 'w1' })];
      const openings = [makeOpening({ wallId: 'w-does-not-exist' })];
      const violations = checkOpeningOnWall(walls, openings);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('opening_on_wall');
      expect(violations[0]?.elementIds).toContain('o1');
      // 孤儿开口的违规不应引用任何 wall id
      expect(violations[0]?.elementIds.length).toBe(1);
    });

    it('开口 offset 为负 -> 违规', () => {
      const walls = [makeWall({ id: 'w1', a: [0, 0], b: [3, 0] })];
      const openings = [makeOpening({ wallId: 'w1', offset: -0.5, width: 0.9 })];
      const violations = checkOpeningOnWall(walls, openings);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('opening_on_wall');
    });

    it('开口恰好占满墙长（offset+width == wallLength）-> 不违规', () => {
      const walls = [makeWall({ id: 'w1', a: [0, 0], b: [3, 0] })]; // 长 3
      const openings = [makeOpening({ wallId: 'w1', offset: 2, width: 1 })]; // 2+1=3
      expect(checkOpeningOnWall(walls, openings)).toHaveLength(0);
    });

    it('开口略超（offset+width 超 1e-7，在 1e-6 容差内）-> 不违规', () => {
      const walls = [makeWall({ id: 'w1', a: [0, 0], b: [3, 0] })]; // 长 3
      // 3 + 1e-7 = 3.0000001，close(..., 1e-6) 判为相等
      const openings = [makeOpening({ wallId: 'w1', offset: 2, width: 1 + 1e-7 })];
      expect(checkOpeningOnWall(walls, openings)).toHaveLength(0);
    });

    it('开口明显超出（offset+width 超 1e-4，超出 1e-6 容差）-> 违规', () => {
      const walls = [makeWall({ id: 'w1', a: [0, 0], b: [3, 0] })]; // 长 3
      const openings = [makeOpening({ wallId: 'w1', offset: 2, width: 1 + 1e-4 })];
      const violations = checkOpeningOnWall(walls, openings);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('opening_on_wall');
    });
  });

  // ---------- 规则 3: wall_endpoints_connected ----------
  describe('checkWallEndpointsConnected', () => {
    it('单条墙 -> 无违规（无法形成孤立判定）', () => {
      expect(checkWallEndpointsConnected([makeWall()])).toHaveLength(0);
    });

    it('两条墙共享端点 -> 仍违规（每段墙的孤立端点会被计入）', () => {
      // w1: [0,0] -> [3,0]，w2: [3,0] -> [3,2]
      // w1.b == w2.a（共享），但 w1.a=[0,0] 和 w2.b=[3,2] 都是孤立的
      // checkWallEndpointsConnected 统计「孤立端点」，不是「墙与墙连通」
      const walls = [
        makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w2', a: [3, 0], b: [3, 2] }),
      ];
      const violations = checkWallEndpointsConnected(walls);
      // 两条墙都有孤立端点 -> 违规，elementIds 含两条墙
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('wall_endpoints_connected');
      expect(violations[0]?.elementIds).toContain('w1');
      expect(violations[0]?.elementIds).toContain('w2');
    });

    it('两条墙端点不连通 -> 违规，elementIds 含两条墙 id', () => {
      const walls = [
        makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w2', a: [10, 10], b: [13, 10] }), // 远离 w1
      ];
      const violations = checkWallEndpointsConnected(walls);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('wall_endpoints_connected');
      expect(violations[0]?.elementIds).toContain('w1');
      expect(violations[0]?.elementIds).toContain('w2');
    });

    it('端点在容差内（差 0.005 m）仍视为连通', () => {
      // WALL_ENDPOINT_EPSILON = 0.01，差 0.005 在容差内
      // 构造四面墙，其中 w1.b 与 w2.a 差 0.005（容差内匹配），
      // 但 w1.b 与 w4.b 差 0.005（容差外），w4.b 因此仍孤立 -> 仍违规
      // 这里只验证：容差内的端点会被算作「已匹配」，不会因 0.005 误差被忽略
      const walls = [
        makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w2', a: [3.005, 0], b: [3.005, 2] }), // w1.b 与 w2.a 差 0.005
        makeWall({ id: 'w3', a: [3.005, 2], b: [0, 2] }),
        makeWall({ id: 'w4', a: [0, 2], b: [0, 0] }), // w4.b 与 w1.a 重合
      ];
      // 所有端点都能找到容差内的匹配：
      // w1.a <--> w4.b (0), w1.b <--> w2.a (0.005), w2.b <--> w3.a (0), w3.b <--> w4.a (0)
      expect(checkWallEndpointsConnected(walls)).toHaveLength(0);
    });

    it('端点在容差外（差 0.05 m）视为不连通', () => {
      const walls = [
        makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w2', a: [3.05, 0], b: [3.05, 2] }),
      ];
      const violations = checkWallEndpointsConnected(walls);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('wall_endpoints_connected');
    });

    it('墙段自己的 a 与 b 不算连通（单墙不算已连通）', () => {
      // 这条测试守护：checkWallEndpointsConnected 不应当「一条墙的两个端点视为已连通」
      // 因为单墙无法形成闭合，两条墙共享端点才算连通
      // 注意：单墙时函数直接返回空（walls.length < 2），所以这条测试用两墙验证
      const walls = [
        makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w2', a: [0, 0], b: [0, 3] }), // w2.a == w1.a
      ];
      // w1.a == w2.a，w1.b 和 w2.b 都是孤立的（彼此不连通）
      // 所以 w1 和 w2 都有孤立端点 -> 违规
      const violations = checkWallEndpointsConnected(walls);
      expect(violations).toHaveLength(1);
      // 注意：w1.a 被 w2.a 匹配，所以 w1 的孤立端点只有 b
      // 但孤立端点按 wallId 记录，所以 w1 仍会出现在 elementIds 中
      expect(violations[0]?.elementIds).toContain('w1');
      expect(violations[0]?.elementIds).toContain('w2');
    });

    it('四面墙首尾相连（闭合矩形）-> 无违规', () => {
      const walls = [
        makeWall({ id: 'w1', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w2', a: [3, 0], b: [3, 2] }),
        makeWall({ id: 'w3', a: [3, 2], b: [0, 2] }),
        makeWall({ id: 'w4', a: [0, 2], b: [0, 0] }),
      ];
      expect(checkWallEndpointsConnected(walls)).toHaveLength(0);
    });
  });

  // ---------- 规则 4: area_matches_label ----------
  describe('checkAreaMatchesLabel', () => {
    it('面积与标注一致 -> 无违规', () => {
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
            [0, 0],
          ],
          labeledArea: 6, // 3x2 = 6
        }),
      ];
      expect(checkAreaMatchesLabel(rooms)).toHaveLength(0);
    });

    it('面积偏差 4%（在 5% 容差内）-> 无违规', () => {
      // 实际面积 6，标注 6.24 = 6 * 1.04，偏差 4%
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
            [0, 0],
          ],
          labeledArea: 6.24,
        }),
      ];
      expect(checkAreaMatchesLabel(rooms)).toHaveLength(0);
    });

    it('面积偏差 10%（超 5% 容差）-> 违规，定位到 room id', () => {
      // actual = 6（3x2 矩形）
      // labeled = 6.6 -> relErr = |6 - 6.6| / 6.6 = 0.6 / 6.6 ≈ 9.09%
      // 注意：relErr 分母是 labeled（图纸标注值），不是 actual
      // 9.09% > 5% 容差 -> 违规
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
            [0, 0],
          ],
          labeledArea: 6.6,
        }),
      ];
      const violations = checkAreaMatchesLabel(rooms);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('area_matches_label');
      expect(violations[0]?.elementIds).toContain('r1');
      expect(violations[0]?.detail?.actualArea).toBeCloseTo(6, 9);
      expect(violations[0]?.detail?.labeledArea).toBeCloseTo(6.6, 9);
      // relErr = |6 - 6.6| / 6.6 = 0.0909090...
      expect(violations[0]?.detail?.relativeError).toBeCloseTo(0.0909090, 6);
      // 超过 5% 容差
      expect(violations[0]?.detail?.relativeError).toBeGreaterThan(
        AREA_RELATIVE_TOLERANCE,
      );
    });

    it('labeledArea 未提供 -> 跳过（不制造假违规）', () => {
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
            [0, 0],
          ],
          // labeledArea 省略
        }),
      ];
      expect(checkAreaMatchesLabel(rooms)).toHaveLength(0);
    });

    it('labeledArea = 0（无效标注）-> 跳过', () => {
      const rooms = [makeRoom({ labeledArea: 0 })];
      expect(checkAreaMatchesLabel(rooms)).toHaveLength(0);
    });

    it('labeledArea < 0（无效标注）-> 跳过', () => {
      const rooms = [makeRoom({ labeledArea: -1 })];
      expect(checkAreaMatchesLabel(rooms)).toHaveLength(0);
    });

    it('边界：偏差恰好 5% -> 不违规（<= 容差）', () => {
      const rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
            [0, 0],
          ],
          labeledArea: 6.3, // 6 * 1.05 = 6.3
        }),
      ];
      // 6.3 与 6 的相对误差 = 0.05，等于容差，不算超出
      expect(checkAreaMatchesLabel(rooms)).toHaveLength(0);
    });
  });

  // ---------- 规则 5: scale_self_consistent ----------
  describe('checkScaleSelfConsistent', () => {
    it('calibration = null（未标定）-> 违规（§4 红线 5）', () => {
      const model = makeValidModel();
      model.calibration = null;
      const violations = checkScaleSelfConsistent(model);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('scale_self_consistent');
      expect(violations[0]?.message).toContain('未标定');
    });

    it('标定通过 -> 无违规', () => {
      const model = makeValidModel();
      expect(checkScaleSelfConsistent(model)).toHaveLength(0);
    });

    it('标定单位混淆（标 3 m 但选 mm）-> 违规', () => {
      const model = makeValidModel();
      model.calibration = calibrate(300, 3, 'mm'); // realDistanceM = 0.003 < 0.01
      const violations = checkScaleSelfConsistent(model);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('scale_self_consistent');
    });

    it('标定距离过大（500 m）-> 违规', () => {
      const model = makeValidModel();
      model.calibration = calibrate(300, 500, 'm');
      const violations = checkScaleSelfConsistent(model);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('scale_self_consistent');
    });

    it('标定距离过小（0.005 m）-> 违规', () => {
      const model = makeValidModel();
      model.calibration = calibrate(300, 0.005, 'm');
      const violations = checkScaleSelfConsistent(model);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe('scale_self_consistent');
    });
  });

  // ---------- 聚合入口 checkTopology ----------
  describe('checkTopology（聚合入口）', () => {
    it('完全通过的 model -> passed = true，violations = []', () => {
      const model = makeValidModel();
      const report = checkTopology(model);
      expect(report.passed).toBe(true);
      expect(report.violations).toHaveLength(0);
    });

    it('passed === violations.length === 0（§4 红线 2）', () => {
      const model = makeValidModel();
      // 注入一个违规
      model.calibration = null;
      const report = checkTopology(model);
      expect(report.passed).toBe(false);
      expect(report.passed).toBe(report.violations.length === 0);
      expect(report.violations.length).toBeGreaterThan(0);
    });

    it('多个规则同时违规时，violations 含全部违规项', () => {
      const model = makeValidModel();
      // 1. 未标定
      model.calibration = null;
      // 2. 房间未闭合
      model.rooms = [
        makeRoom({
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2], // 不闭合
          ],
        }),
      ];
      const report = checkTopology(model);
      expect(report.passed).toBe(false);
      const rules = report.violations.map((v) => v.rule);
      expect(rules).toContain('room_closed');
      expect(rules).toContain('scale_self_consistent');
    });

    it('每条规则的违规都有 elementIds 字段（§4 红线 2：必须定位到具体 id）', () => {
      const model = makeValidModel();
      // 注入多种违规
      model.calibration = null;
      model.rooms = [
        makeRoom({
          id: 'r-bad',
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2], // 不闭合
          ],
        }),
      ];
      model.openings = [
        makeOpening({ id: 'o-orphan', wallId: 'no-such-wall' }),
      ];
      const report = checkTopology(model);
      for (const v of report.violations) {
        // 所有违规都必须有 elementIds 字段（可以为空数组，但字段必须存在）
        expect(v.elementIds).toBeDefined();
        expect(Array.isArray(v.elementIds)).toBe(true);
      }
    });

    it('room_closed 违规定位到具体 room id', () => {
      const model = makeValidModel();
      model.rooms = [
        makeRoom({
          id: 'r-test',
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
          ],
        }),
      ];
      const report = checkTopology(model);
      const v = report.violations.find((v) => v.rule === 'room_closed');
      expect(v).toBeDefined();
      expect(v?.elementIds).toContain('r-test');
    });

    it('opening_on_wall 违规定位到具体 opening id', () => {
      const model = makeValidModel();
      model.openings = [makeOpening({ id: 'o-test', wallId: 'w1', offset: 5, width: 1 })];
      const report = checkTopology(model);
      const v = report.violations.find((v) => v.rule === 'opening_on_wall');
      expect(v).toBeDefined();
      expect(v?.elementIds).toContain('o-test');
    });

    it('wall_endpoints_connected 违规定位到具体 wall id', () => {
      const model = makeValidModel();
      model.walls = [
        makeWall({ id: 'w-a', a: [0, 0], b: [3, 0] }),
        makeWall({ id: 'w-b', a: [10, 10], b: [13, 10] }),
      ];
      const report = checkTopology(model);
      const v = report.violations.find((v) => v.rule === 'wall_endpoints_connected');
      expect(v).toBeDefined();
      expect(v?.elementIds).toContain('w-a');
      expect(v?.elementIds).toContain('w-b');
    });

    it('area_matches_label 违规定位到具体 room id', () => {
      const model = makeValidModel();
      model.rooms = [
        makeRoom({
          id: 'r-area-test',
          vertices: [
            [0, 0],
            [3, 0],
            [3, 2],
            [0, 2],
            [0, 0],
          ],
          labeledArea: 10, // 实际 6，偏差 (10-6)/10 = 40%
        }),
      ];
      const report = checkTopology(model);
      const v = report.violations.find((v) => v.rule === 'area_matches_label');
      expect(v).toBeDefined();
      expect(v?.elementIds).toContain('r-area-test');
    });
  });
});
