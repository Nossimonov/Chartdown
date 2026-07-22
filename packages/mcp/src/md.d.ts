// esbuild bundles .md imports as text (build.mjs loader config).
declare module "*.md" {
  const text: string;
  export default text;
}
