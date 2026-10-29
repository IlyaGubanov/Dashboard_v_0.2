/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** адрес подложки карты, например https://tiles.example.ru/{z}/{x}/{y}.png */
  readonly VITE_MAP_TILES?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
}
