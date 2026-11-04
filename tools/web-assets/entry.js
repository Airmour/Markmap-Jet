import * as d3 from 'd3';
import { Transformer } from 'markmap-lib';
import { Markmap, deriveOptions, defaultOptions } from 'markmap-view';
import katex from 'katex';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

window.d3 = d3;
window.katex = katex;
window.hljs = hljs;
window.markmapSanitize = html => DOMPurify.sanitize(html);
window.markmap = { Transformer, Markmap, deriveOptions, defaultOptions };
