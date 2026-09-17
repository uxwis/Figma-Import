export const LOAD_ERROR='插件加载异常，请关闭后重新打开。';
export const PSD_MEMORY_ERROR='该文件图层或图片过大，请在 Photoshop 中按画板拆分后再导入。';
export const MEMORY_ERROR='导入所需内存不足，请拆分文件后重试。';
export const sizeError=(megabytes:number)=>'文件超过 '+megabytes+' MB，请拆分后再导入。';
export function importError(error:unknown):string {
 const message=error instanceof Error?error.message:String(error);
 return /exceeded memory limit|out of memory|memory access out of bounds|cannot enlarge memory|allocation failed|array buffer allocation|invalid (?:typed array|array buffer) length/i.test(message)?MEMORY_ERROR:message;
}
