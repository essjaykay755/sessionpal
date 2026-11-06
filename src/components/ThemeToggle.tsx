import { Moon, Sun } from "@phosphor-icons/react";
import { useApp } from "../lib/store";
import { IconButton } from "./ui";

export function ThemeToggle() {
  const { effectiveTheme, toggleTheme } = useApp();
  return (
    <IconButton
      icon={effectiveTheme === "dark" ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
      label={effectiveTheme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
      onClick={toggleTheme}
      tooltipSide="bottom"
    />
  );
}
