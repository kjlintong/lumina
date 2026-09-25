/**
 * 基础家具上下文（P4 渲染层）
 *
 * 方案 §2.4：家具只作为照明的**遮挡与反射上下文**存在，不做软装电商。
 * 因此这里只做几何位置占位（BoxGeometry 组合），不做品牌与材质细节。
 *
 * 每件家具按活动区类型生成 1-3 个功能件（§4.5.8「功能槽位」）：
 *  - sleep    床（床垫+床头板）
 *  - work     书桌（桌面+四腿）+ 椅子
 *  - dining   餐桌（桌面+四腿）
 *  - lounge   沙发（座+靠背+扶手）+ 茶几
 *  - kitchen  操作台（柜体+台面）
 *  - bathroom 洗手台（柜体+台面）
 *  - reading  扶手椅 + 边几
 *  - nursery  矮床 + 收纳柜
 *  - wardrobe 衣柜（开放框）
 *  - entry    换鞋凳 + 鞋柜
 *  - 自定义类型：一张小几（保守占位，保证非空）
 *
 * 几何约束：
 *  - 所有尺寸由 zone.size 按比例推出，保证任何区尺寸下家具都落在区范围内。
 *  - 家具在活动区**局部坐标系**内，group 携带 zone.pos / zone.rotY：
 *    区移动/旋转 → 家具整体跟随（家具是区的一部分，不是 Fixture，
 *    不受 ADR-13 绑定跟随机制约束）。
 *  - 所有子 mesh 的底面落在局部 y=0（房间地面）上。
 *
 * 阴影红线（§2.4）：所有子 mesh 必须 castShadow = receiveShadow = true，
 * 否则光会穿过去，照度场失真。材质取木色/布色 MeshStandardMaterial，
 * 中等粗糙度（家具反射率 0.2-0.7 的中间档）。
 */

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { Material } from 'three';
import type { ActivityZone } from '../core/types.js';

/** 在 group 内放一个底面落在 yBottom 的方块，返回 Mesh（统一开启阴影） */
function part(
  group: Group,
  w: number,
  h: number,
  d: number,
  x: number,
  yBottom: number,
  z: number,
  material: Material,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.position.set(x, yBottom + h / 2, z);
  // 遮挡上下文红线：家具必须投影并接收阴影，否则光穿模、照度场失真
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** 桌腿：四角各一根 */
function legs(
  group: Group,
  topW: number,
  topD: number,
  height: number,
  cx: number,
  cz: number,
  material: Material,
): void {
  const t = 0.05;
  const ox = topW / 2 - t / 2 - 0.02;
  const oz = topD / 2 - t / 2 - 0.02;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part(group, t, height, t, cx + sx * ox, 0, cz + sz * oz, material);
    }
  }
}

/** 扶手椅 / 沙发通用件：座 + 靠背 + 两扶手 */
function armchair(
  group: Group,
  w: number,
  d: number,
  x: number,
  z: number,
  seatH: number,
  material: Material,
): void {
  part(group, w, seatH, d, x, 0, z, material); // 座
  part(group, w, 0.45, 0.12, x, seatH, z - d / 2 + 0.06, material); // 靠背
  const armW = Math.min(0.14, w * 0.2);
  part(group, armW, 0.18, d, x - w / 2 + armW / 2, seatH, z, material); // 左扶手
  part(group, armW, 0.18, d, x + w / 2 - armW / 2, seatH, z, material); // 右扶手
}

/**
 * 按活动区类型构建家具 Group。
 * group 携带 zone.pos（y=0）与 zone.rotY；子 mesh 用局部坐标、底面贴地。
 */
export function buildFurniture(zone: ActivityZone): Group {
  const group = new Group();
  group.name = `furniture:${zone.key}`;
  group.position.set(zone.pos[0], 0, zone.pos[1]);
  group.rotation.y = zone.rotY;

  // 木色 / 布色 / 石色：中等粗糙度，漫反射为主（家具反射率 0.2-0.7 的中间档）
  const wood = new MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.75, metalness: 0.0 });
  const fabric = new MeshStandardMaterial({ color: 0x6f7f8f, roughness: 0.95, metalness: 0.0 });
  const stone = new MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5, metalness: 0.0 });

  const [w, d] = zone.size;

  switch (zone.type) {
    case 'sleep': {
      // 床垫 + 床头板（床头靠 -z 一侧）
      part(group, w * 0.7, 0.3, d * 0.78, 0, 0.05, d * 0.06, fabric);
      part(group, w * 0.7, 0.9, 0.08, 0, 0, -d / 2 + 0.04, wood);
      break;
    }
    case 'work': {
      // 书桌（桌面+四腿，靠 -z 一侧）+ 椅子
      const deskW = w * 0.7;
      const deskD = d * 0.45;
      const deskZ = -d * 0.2;
      part(group, deskW, 0.04, deskD, 0, 0.72, deskZ, wood);
      legs(group, deskW, deskD, 0.72, 0, deskZ, wood);
      const chairZ = deskZ + deskD / 2 + 0.15; // 椅子半收在桌下，保证落在区范围内
      part(group, 0.42, 0.05, 0.42, 0, 0.43, chairZ, fabric);
      part(group, 0.42, 0.5, 0.05, 0, 0.48, chairZ + 0.185, fabric);
      break;
    }
    case 'dining': {
      // 餐桌（桌面+四腿）
      const topW = w * 0.75;
      const topD = d * 0.7;
      part(group, topW, 0.04, topD, 0, 0.74, 0, wood);
      legs(group, topW, topD, 0.74, 0, 0, wood);
      break;
    }
    case 'lounge': {
      // 沙发（-z 半区）+ 茶几（+z 半区）
      armchair(group, w * 0.6, d * 0.4, 0, -d * 0.22, 0.35, fabric);
      part(group, w * 0.35, 0.35, d * 0.25, 0, 0, d * 0.25, wood);
      break;
    }
    case 'kitchen': {
      // 操作台：柜体 + 台面
      part(group, w * 0.9, 0.85, d * 0.8, 0, 0, 0, wood);
      part(group, w * 0.92, 0.05, d * 0.82, 0, 0.85, 0, stone);
      break;
    }
    case 'bathroom': {
      // 洗手台：柜体 + 台面
      part(group, w * 0.5, 0.8, d * 0.5, 0, 0, 0, wood);
      part(group, w * 0.55, 0.06, d * 0.55, 0, 0.8, 0, stone);
      break;
    }
    case 'reading': {
      // 扶手椅（偏 -x）+ 小边几（偏 +x）
      armchair(group, Math.min(0.65, w * 0.45), Math.min(0.65, d * 0.5), -w * 0.18, 0, 0.4, fabric);
      part(group, Math.min(0.4, w * 0.3), 0.5, Math.min(0.4, d * 0.35), w * 0.28, 0, 0, wood);
      break;
    }
    case 'nursery': {
      // 矮床（偏 -x）+ 收纳柜（偏 +x）
      part(group, w * 0.55, 0.3, d * 0.6, -w * 0.18, 0, 0, fabric);
      part(group, w * 0.28, 0.8, d * 0.4, w * 0.3, 0, -d * 0.2, wood);
      break;
    }
    case 'wardrobe': {
      // 衣柜开放框：两侧板 + 顶板 + 背板 + 一层搁板
      const cabW = w * 0.7;
      const cabD = d * 0.5;
      const cabH = 1.8;
      part(group, 0.05, cabH, cabD, -cabW / 2 + 0.025, 0, 0, wood);
      part(group, 0.05, cabH, cabD, cabW / 2 - 0.025, 0, 0, wood);
      part(group, cabW, 0.05, cabD, 0, cabH, 0, wood);
      part(group, cabW, cabH, 0.03, 0, 0, -cabD / 2 + 0.015, wood);
      part(group, cabW - 0.1, 0.03, cabD - 0.06, 0, 1.0, 0, wood);
      break;
    }
    case 'entry': {
      // 换鞋凳（偏 -x）+ 鞋柜（偏 +x）
      part(group, w * 0.4, 0.4, d * 0.35, -w * 0.22, 0, 0, fabric);
      part(group, w * 0.32, 0.9, d * 0.3, w * 0.28, 0, -d * 0.2, wood);
      break;
    }
    default: {
      // 自定义类型：一张小几占位，保证非空
      part(group, Math.min(0.8, w * 0.5), 0.5, Math.min(0.8, d * 0.5), 0, 0, 0, wood);
      break;
    }
  }

  return group;
}
