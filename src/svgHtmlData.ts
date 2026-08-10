import {
  newHTMLDataProvider,
  type IAttributeData,
  type IHTMLDataProvider,
} from 'vscode-html-languageservice';

const tagAttributes: Record<string, string[]> = {
  svg: ['viewBox', 'width', 'height', 'preserveAspectRatio', 'xmlns'],
  circle: ['cx', 'cy', 'r', 'pathLength'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'pathLength'],
  line: ['x1', 'y1', 'x2', 'y2', 'pathLength'],
  path: ['d', 'pathLength'],
  polygon: ['points', 'pathLength'],
  polyline: ['points', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'pathLength'],
  image: ['x', 'y', 'width', 'height', 'href', 'preserveAspectRatio', 'crossorigin'],
  use: ['x', 'y', 'width', 'height', 'href'],
  symbol: ['viewBox', 'width', 'height', 'preserveAspectRatio', 'refX', 'refY'],
  marker: ['markerWidth', 'markerHeight', 'markerUnits', 'orient', 'preserveAspectRatio', 'refX', 'refY', 'viewBox'],
  pattern: ['x', 'y', 'width', 'height', 'href', 'patternContentUnits', 'patternTransform', 'patternUnits', 'preserveAspectRatio', 'viewBox'],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientTransform', 'gradientUnits', 'href', 'spreadMethod'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientTransform', 'gradientUnits', 'href', 'spreadMethod'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  clipPath: ['clipPathUnits'],
  mask: ['x', 'y', 'width', 'height', 'maskContentUnits', 'maskUnits'],
  filter: ['x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits'],
  text: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  tspan: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  textPath: ['href', 'startOffset', 'method', 'spacing', 'side'],
  foreignObject: ['x', 'y', 'width', 'height'],
  view: ['viewBox', 'preserveAspectRatio', 'viewTarget'],
  feBlend: ['in', 'in2', 'mode', 'result'],
  feColorMatrix: ['in', 'type', 'values', 'result'],
  feComponentTransfer: ['in', 'result'],
  feComposite: ['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result'],
  feConvolveMatrix: ['in', 'order', 'kernelMatrix', 'divisor', 'bias', 'targetX', 'targetY', 'edgeMode', 'preserveAlpha', 'result'],
  feDiffuseLighting: ['in', 'surfaceScale', 'diffuseConstant', 'kernelUnitLength', 'lighting-color', 'result'],
  feDisplacementMap: ['in', 'in2', 'scale', 'xChannelSelector', 'yChannelSelector', 'result'],
  feDistantLight: ['azimuth', 'elevation'],
  feDropShadow: ['dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity', 'result'],
  feFlood: ['flood-color', 'flood-opacity', 'result'],
  feFuncA: ['type', 'tableValues', 'slope', 'intercept', 'amplitude', 'exponent', 'offset'],
  feFuncB: ['type', 'tableValues', 'slope', 'intercept', 'amplitude', 'exponent', 'offset'],
  feFuncG: ['type', 'tableValues', 'slope', 'intercept', 'amplitude', 'exponent', 'offset'],
  feFuncR: ['type', 'tableValues', 'slope', 'intercept', 'amplitude', 'exponent', 'offset'],
  feGaussianBlur: ['in', 'stdDeviation', 'edgeMode', 'result'],
  feImage: ['href', 'preserveAspectRatio', 'crossorigin', 'result'],
  feMerge: ['result'],
  feMergeNode: ['in'],
  feMorphology: ['in', 'operator', 'radius', 'result'],
  feOffset: ['in', 'dx', 'dy', 'result'],
  fePointLight: ['x', 'y', 'z'],
  feSpecularLighting: ['in', 'surfaceScale', 'specularConstant', 'specularExponent', 'kernelUnitLength', 'lighting-color', 'result'],
  feSpotLight: ['x', 'y', 'z', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'specularExponent', 'limitingConeAngle'],
  feTile: ['in', 'result'],
  feTurbulence: ['baseFrequency', 'numOctaves', 'seed', 'stitchTiles', 'type', 'result'],
};

const containerTags = [
  'a', 'defs', 'desc', 'g', 'metadata', 'script', 'style', 'switch', 'title',
];
const animationTags = ['animate', 'animateMotion', 'animateTransform', 'mpath', 'set'];
const shapeTags = ['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect'];
const paintTags = ['linearGradient', 'radialGradient', 'stop', 'solidcolor'];
const structuralTags = [
  'svg', 'symbol', 'use', 'image', 'marker', 'mask', 'pattern', 'clipPath', 'foreignObject', 'view',
];
const textTags = ['text', 'textPath', 'tspan'];
const filterTags = Object.keys(tagAttributes).filter(name => name.startsWith('fe'));
const allTags = [...new Set([
  ...containerTags,
  ...animationTags,
  ...shapeTags,
  ...paintTags,
  ...structuralTags,
  ...textTags,
  'filter',
  ...filterTags,
])];

const globalAttributeNames = [
  'id', 'class', 'style', 'lang', 'tabindex', 'role', 'aria-label', 'aria-hidden',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'opacity', 'transform', 'transform-origin', 'display', 'visibility', 'color',
  'clip-path', 'clip-rule', 'mask', 'filter', 'pointer-events', 'vector-effect',
  'paint-order', 'shape-rendering', 'text-rendering',
];

const animationAttributes = [
  'attributeName', 'begin', 'dur', 'end', 'min', 'max', 'restart', 'repeatCount',
  'repeatDur', 'fill', 'calcMode', 'values', 'keyTimes', 'keySplines', 'from', 'to', 'by',
];

function attributes(names: string[]): IAttributeData[] {
  return names.map(name => ({ name }));
}

export const svgHtmlDataProvider: IHTMLDataProvider = newHTMLDataProvider('lit-volar-svg', {
  version: 1.1,
  tags: allTags.map(name => ({
    name,
    description: `SVG <${name}> element.`,
    attributes: attributes([
      ...(tagAttributes[name] ?? []),
      ...(animationTags.includes(name) ? animationAttributes : []),
    ]),
  })),
  globalAttributes: attributes(globalAttributeNames),
});
