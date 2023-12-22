/* eslint-env node */
module.exports = {
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:import/recommended',
        'plugin:import/typescript',
    ],
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    root: true,
    ignorePatterns: ["src/generated/*", "dist/**/*"],
    env: {
        mocha: true,
        node: true
    },
    rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": [
            "error",
            {
                "argsIgnorePattern": "^_",
                // "varsIgnorePattern": "^_",
                // "caughtErrorsIgnorePattern": "^_"
            }
        ],
        "import/no-named-as-default-member": "off",
        "import/order": [
            "error",
            {
                "groups": [
                    "builtin",
                    "external",
                    "internal",
                    "parent",
                    "sibling",
                    "index",
                    "object",
                    "type"
                ],
            }
        ],
    },
    settings: {
        "import/resolver": {
            // see See also https://github.com/import-js/eslint-import-resolver-typescript#configuration
            typescript: true,
            node: true,
        }
    }
};
