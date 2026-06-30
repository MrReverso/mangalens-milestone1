import type { CSSProperties } from "react";
import styles from "./LanguageSelect.module.css";

interface LanguageSelectProps {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

export default function LanguageSelect({
  label,
  value,
  options,
  onChange,
}: LanguageSelectProps) {
  const selectStyle: CSSProperties = {
    width: "100%",
  };

  return (
    <div className={styles["language-select"]}>
      <label>{label}</label>
      <select
        style={selectStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}