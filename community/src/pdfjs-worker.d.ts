// pdfjs-dist 只给 legacy/build/pdf.js 发了类型声明，pdf.worker.js 没有，
// 但我们必须直接导入它才能拿到 WorkerMessageHandler 注入 fake worker。
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
