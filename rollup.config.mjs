import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const integrationModules = [
  'ga4', 'gtm', 'facebook-pixel', 'linkedin-insight', 'tiktok-pixel',
  'umami', 'plausible', 'matomo', 'hubspot', 'hotjar',
  'clarity', 'segment', 'mixpanel', 'twitter-pixel', 'google-ads',
  'index'
];

export default [
  // Loader script (vanilla JS, minify only)
  {
    input: 'configurator/loader.js',
    output: {
      file: 'configurator/loader.min.js',
      format: 'es',
    },
    plugins: [
      terser({
        format: { comments: false },
        compress: { passes: 2 },
        mangle: { toplevel: true },
      }),
    ],
  },
  // Core bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/cookieproof.esm.js',
        format: 'es',
      },
      {
        file: 'dist/cookieproof.umd.js',
        format: 'umd',
        name: 'CookieProof',
      },
    ],
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: 'dist',
      }),
      terser({
        format: { comments: false },
      }),
    ],
  },
  // Integrations bundle
  ...integrationModules.map((mod) => ({
    input: `integrations/${mod}.ts`,
    output: [
      {
        file: `dist/integrations/${mod}.esm.js`,
        format: 'es',
      },
      {
        file: `dist/integrations/${mod}.umd.js`,
        format: 'umd',
        name: `CB_${mod.replace(/-/g, '_')}`,
      },
    ],
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationDir: undefined,
        compilerOptions: {
          declaration: false,
          declarationDir: undefined,
        },
      }),
      terser({
        format: { comments: false },
      }),
    ],
  })),
];
