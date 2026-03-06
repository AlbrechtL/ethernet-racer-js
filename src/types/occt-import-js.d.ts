declare module "occt-import-js" {
  type OcctResult = {
    success: boolean;
  };

  type OcctModule = {
    ReadStepFile: (content: Uint8Array, params: object | null) => OcctResult;
  };

  type OcctFactoryOptions = {
    locateFile?: (path: string, prefix?: string) => string;
  };

  const occtImportJsFactory: (
    options?: OcctFactoryOptions,
  ) => Promise<OcctModule>;

  export default occtImportJsFactory;
}

declare module "occt-import-js/dist/occt-import-js.wasm?url" {
  const assetUrl: string;
  export default assetUrl;
}