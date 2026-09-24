/**
 * 数字输入字段：受控，onChange 时若能解析为有限数则提交。
 * 非法中间输入（如 "-" / 空）不提交，避免把脏值写进 store。
 */

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** 显示精度（toFixed 小数位），默认按 step 推断 */
  digits?: number;
  disabled?: boolean;
}

function fmt(v: number, digits: number): string {
  return v.toFixed(digits);
}

export function NumberField({ label, value, onCommit, step = 0.1, min, max, digits, disabled }: NumberFieldProps) {
  const d = digits ?? (step < 1 ? 2 : 0);
  return (
    <label className={`field${disabled ? ' disabled' : ''}`}>
      <span className="field-label">{label}</span>
      <input
        className="input"
        type="number"
        value={fmt(value, d)}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onCommit(v);
        }}
      />
    </label>
  );
}
