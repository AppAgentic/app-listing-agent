import { normalizeIconStyle, type IconStyle, type ModernIconStyle } from '../constants'

export const ICON_STYLE_LABELS: Record<ModernIconStyle, string> = {
  'liquid-glass': 'Liquid Glass', 'tactile-3d': 'Tactile 3D object', mascot: 'Character mascot',
  'gradient-glyph': 'Bold gradient glyph', clay: 'Soft clay', 'premium-dark': 'Premium dark',
  illustrated: 'Illustrated', isometric: 'Isometric scene', line: 'Minimal line', brand: 'Match my brand',
}
export const ICON_ART_DIRECTIONS: Record<ModernIconStyle, string> = {
  'liquid-glass': 'Sculpt the subject from two or three substantial layers of translucent frosted glass. Saturated colour refracts through the object; polished specular rims, soft caustics and deliberate depth separate the layers. Rich luminous background, restrained bloom. The silhouette stays bold rather than disappearing into transparency. No enclosing glass tile.',
  'tactile-3d': 'One hyper-polished physical hero object with a distinctive sculpted silhouette. Enamel, brushed metal and soft rubber with believable material transitions. Large softbox key light, crisp rim light, gentle contact shadow. Close studio composition on a confident vivid background; exquisite craft without a busy environment.',
  mascot: 'An original lovable character embodying the core benefit. Feature-animation-quality sculpting, expressive eyes and a distinctive pose, one immediately recognisable silhouette. Confident saturated backdrop and warm cinematic key light. Limit accessories to one meaningful prop; avoid generic stock animals or existing brand characters.',
  'gradient-glyph': 'A single custom geometric symbol with crisp vector edges and a luminous multi-stop colour gradient. Controlled optical balance, a purposeful negative-space cut and extremely subtle grain. Bold premium technology identity; no piles of disconnected shapes, no alphabetic monogram, no pseudo-lettering.',
  clay: 'Hand-sculpted matte clay hero with soft rounded volumes, tiny tactile surface imperfections and warm diffuse studio lighting. Gentle occlusion gives tangible depth. Two or three harmonious colours, cheerful confident silhouette, generous clear space. Avoid plastic gloss and excessive miniature parts.',
  'premium-dark': 'A precise sculptural hero emerging from deep ink black. Brushed titanium or black ceramic, controlled coloured rim illumination, a single electric accent and rich tonal separation. Understated professional instrument quality. Preserve a readable silhouette at thumbnail size; no cyberpunk clutter or random neon circuitry.',
  illustrated: 'A bespoke painterly hero illustration with confident sweeping contours, selective gouache texture and a carefully limited vivid palette. Graphic editorial composition with one compelling visual story. Broad light and shadow shapes; hand-crafted character without fine hatching, scenery clutter or tiny decorations.',
  isometric: 'A tiny beautifully crafted isometric diorama that reads as one connected object. One main structure and at most two large supporting forms, precise perspective, tactile materials, directional studio lighting and clean ambient shadows. Fill the safe area boldly; omit tiny windows, signage and miniature visual noise.',
  line: 'One continuous, thick, elegantly curved outline describing one recognisable object. Uniform substantial stroke, two colours with very high contrast and generous negative space. At most three interior strokes. No grids, repeated squares, labyrinths, QR codes, barcodes, circuit patterns, micro-details or crosshatching.',
  brand: 'Let the supplied brand colours and reference define the visual language. Preserve the recognisable core symbol, palette hierarchy and personality while refining proportion, silhouette, material and lighting to premium contemporary quality. Do not impose an unrelated preset. Without a reference, build a distinctive simple emblem from the app purpose and specified colours.',
}
export function getStyleInstructions(style: IconStyle = 'tactile-3d'): string {
  return ICON_ART_DIRECTIONS[normalizeIconStyle(style)]
}
