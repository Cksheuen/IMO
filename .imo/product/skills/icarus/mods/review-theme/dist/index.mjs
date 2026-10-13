var i={paper:{ink:"#33291f",muted:"#786a5b",paper:"#efe2c7",card:"#fffaf0",line:"#d4bd96",accent:"#a6532b"},dark:{ink:"#e5e7eb",muted:"#9ca3af",paper:"#111827",card:"#1f2937",line:"#4b5563",accent:"#fbbf24"}},f={id:"review-theme",apiVersion:1,requires:[],mount({onCleanup:o},{theme:s="paper",tokens:c={}}={}){let n=i[s];if(!n)throw new Error("Unknown review theme");let r={...n,...c};for(let[a,t]of Object.entries(r))if(!/^[a-z][a-z-]*$/.test(a)||typeof t!="string"||!/^#[0-9a-f]{3,8}$/i.test(t))throw new Error("Theme tokens must be CSS color hex values");let e=document.createElement("style");e.dataset.icarusModStyle="review-theme",e.textContent="[data-icarus-david-root]{"+Object.entries(r).map(([a,t])=>"--"+a+":"+t+"!important").join(";")+"}",document.head.append(e),o(()=>e.remove())}};export{f as default};

/*! # Third-party notices

## lavish-axi

Label normalization in project/src/lib/logicGraph.ts adapts whiteboard-core.js at ca4c59d5b3ef84ae7f6f7f93fcaa415ade8a9c73. Fixed-frame fitting and font-ready measurement also informed the integration.

Source: https://github.com/kunchenguid/lavish-axi

MIT License

Copyright (c) 2026 Kun Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
