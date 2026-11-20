import * as d3 from 'd3';
import { parse } from '@markmap/parse';
import { Markmap, resolveViewOptions } from '@markmap/view';
import { defaultContentPlugins, toSVGString } from '@markmap/render';
import { remarkMath, mathContent } from '@markmap/plugin-math';
import { toPNG } from '@markmap/canvas';

// Keep the upstream note marker's drawing and hit testing, but reserve more space
// so the marker is easier to see and click at normal font sizes.
const contentPlugins = defaultContentPlugins.map(plugin => {
  if (plugin.name !== 'notes') return plugin;
  const marker = plugin.atoms.noteMarker;
  return {
    ...plugin,
    atoms: { ...plugin.atoms, noteMarker: {
      ...marker,
      measure(_inline, style) {
        const dot = Math.round(style.font.size * 0.65);
        return { width: style.font.size * 0.35 + dot, height: dot, baseline: dot / 2 + style.font.size * 0.27 };
      },
    } },
  };
});

window.d3 = d3;
window.markmap = { parse, Markmap, resolveViewOptions, defaultContentPlugins: contentPlugins, toSVGString, toPNG, remarkMath, mathContent };
