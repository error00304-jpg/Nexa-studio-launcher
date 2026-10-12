// Marca configurable: logotipo, colores y nombre. Editar aquí para personalizar.
export const brand = {
  name: 'NexaStudios',
  tagline: 'Eventos de Minecraft',
  logoUrl: null as string | null, // p. ej. './logo.png' colocado en src/renderer/
  colors: {
    '--bg': '#0e1014',
    '--surface': '#171a21',
    '--surface-2': '#1f232c',
    '--text': '#e8eaf0',
    '--muted': '#8b92a5',
    '--accent': '#7c5cff',
    '--danger': '#ff6b6b',
    '--ok': '#4cd08a'
  }
};

export function applyBrand(): void {
  for (const [k, v] of Object.entries(brand.colors)) document.documentElement.style.setProperty(k, v);
}
