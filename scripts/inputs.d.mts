export declare const SDK_ROOT: string;
export declare const INPUTS: Readonly<{
  contract: string;
  webhookVectors: string;
  webhookSnippet: string;
}>;
export declare const IN_MONOREPO: boolean;
export declare function monorepoPath(rel: string): string;
export declare function inputPath(name: keyof typeof INPUTS): string;
