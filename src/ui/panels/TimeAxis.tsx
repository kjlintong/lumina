/**
 * 时间轴（P8c）：16:00 → 21:00 的横向渐变轨道 + 发光圆球手柄。
 *
 * 替换原 `<input type="time">` 主轨道（视觉不可定制）。轨道本体是 `<div>`
 * （背景线性渐变模拟日落→夜晚），手柄是绝对定位的圆形 `<div>`。
 * 可访问性：手柄用 `role="slider"` + 方向键调节，不依赖原生 range。
 *
 * 颜色/格式化数学都在纯函数里（`hourToRatio` / `formatHour`），
 * 组件本身只做 DOM 交互，jsdom 下可测。
 */

import { useCallback, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { formatHour } from '../../App.js';

export interface TimeAxisProps {
  /** 当前时间（小时，0..24 浮点；本组件只渲染 16..21 区间） */
  hour: number;
  onHourChange: (h: number) => void;
  speed: number;
  onSpeedChange: (v: number) => void;
  shadows: boolean;
  onShadowsChange: (v: boolean) => void;
}

/** 时间轴区间（产品主场景：日落到夜晚） */
export const AXIS_MIN = 16;
export const AXIS_MAX = 21;
/** 键盘方向键步长（小时）。1/12 = 5 分钟 */
const KEY_STEP = 1 / 12;

/** 6 个整点刻度（16/17/18/19/20/21） */
const TICKS = [16, 17, 18, 19, 20, 21];

/**
 * 轨道背景渐变：颜色键按虚拟时间从 16:00 暖黄 → 21:00 深夜蓝紫。
 * 纯函数便于单测断言颜色键齐全。
 */
export function trackGradient(): string {
  return `linear-gradient(90deg,
    #ffcc66 0%,
    #ff8a3a 30%,
    #c44a2a 55%,
    #5a4a8a 80%,
    #2a2a5a 100%)`;
}

/** hour → 轨道上的 0..1 比例（越界钳到端点） */
export function hourToRatio(hour: number): number {
  const clamped = Math.min(AXIS_MAX, Math.max(AXIS_MIN, hour));
  return (clamped - AXIS_MIN) / (AXIS_MAX - AXIS_MIN);
}

/** 客户端 X 坐标 → hour；轨道宽度为 0（jsdom）时返回当前 hour，避免除零 */
function clientXToHour(clientX: number, track: HTMLElement, fallback: number): number {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return fallback;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return AXIS_MIN + ratio * (AXIS_MAX - AXIS_MIN);
}

export function TimeAxis({
  hour,
  onHourChange,
  speed,
  onSpeedChange,
  shadows,
  onShadowsChange,
}: TimeAxisProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const emitFromPointer = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      onHourChange(clientXToHour(e.clientX, track, hour));
    },
    [hour, onHourChange],
  );

  const onTrackPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    // 捕获指针，拖出轨道也能持续跟随
    e.currentTarget.setPointerCapture?.(e.pointerId);
    emitFromPointer(e);
  };
  const onTrackPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) emitFromPointer(e);
  };
  const onTrackPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onKnobKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -KEY_STEP;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = KEY_STEP;
    else return;
    e.preventDefault();
    const next = Math.min(AXIS_MAX, Math.max(AXIS_MIN, hour + delta));
    onHourChange(next);
  };

  const ratio = hourToRatio(hour);

  return (
    <div className="time-axis">
      {/* 左端药丸：当前时间 HH:MM */}
      <div className="time-pill">{formatHour(hour)}</div>

      <div className="time-track-wrap">
        <div
          ref={trackRef}
          className="time-track"
          style={{ background: trackGradient() }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
        >
          <div
            className="time-knob"
            role="slider"
            tabIndex={0}
            aria-label="时间"
            aria-valuemin={AXIS_MIN}
            aria-valuemax={AXIS_MAX}
            aria-valuenow={Math.round(hour * 100) / 100}
            aria-valuetext={formatHour(hour)}
            style={{ left: `${ratio * 100}%` }}
            onKeyDown={onKnobKeyDown}
          />
        </div>
        <div className="time-ticks">
          {TICKS.map((t) => (
            <span key={t} className="time-tick">
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* 右侧低调控件：速度 + 阴影 */}
      <div className="time-axis-side">
        <label className="time-axis-ctl">
          速度
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          />
        </label>
        <label className="time-axis-ctl">
          <input
            type="checkbox"
            checked={shadows}
            onChange={(e) => onShadowsChange(e.target.checked)}
          />
          阴影
        </label>
      </div>
    </div>
  );
}
