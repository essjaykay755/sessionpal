import {
  AppWindow,
  BookOpen,
  Browser,
  CloudArrowUp,
  Database,
  DeviceMobile,
  FilmStrip,
  Folder,
  MapTrifold,
  MoonStars,
  Notebook,
  Package,
  PaintBrush,
  Receipt,
  RocketLaunch,
  Shapes,
  TextAa,
  type IconProps,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

const ICONS: Record<string, ComponentType<IconProps>> = {
  AppWindow,
  BookOpen,
  Browser,
  CloudArrowUp,
  Database,
  DeviceMobile,
  FilmStrip,
  Folder,
  MapTrifold,
  MoonStars,
  Notebook,
  Package,
  PaintBrush,
  Receipt,
  RocketLaunch,
  Shapes,
  TextAa,
};

export function projectIcon(name: string): ComponentType<IconProps> {
  return ICONS[name] ?? Folder;
}
