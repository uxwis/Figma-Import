declare const __PLUGIN_VERSION__: string;
declare const __PLUGIN_BUILD_ID__: string;
export const PLUGIN_VERSION=typeof __PLUGIN_VERSION__==='undefined'?'development':__PLUGIN_VERSION__;
export const BUILD_ID=typeof __PLUGIN_BUILD_ID__==='undefined'?'development':__PLUGIN_BUILD_ID__;
