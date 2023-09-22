
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: "src/generated/github-schema-loader.ts",
  documents: ["src/mutations/*.graphql", "src/queries/*.graphql"],
  generates: {
    // "src/generated/schema.ts": {
    //   plugins: ["typescript", "typescript-document-nodes"]
    // },
    "src/generated/queries.ts": {
      plugins: ["typescript", "typescript-operations", "typescript-document-nodes"],
      config: {
        onlyOperationTypes: true
      }
    }
  },
  require: ["ts-node/register"],
};

export default config;
