import nock from "nock";
import {join} from "path";

export default function initializeNockBack() {
    const nockBack = nock.back;

    nockBack.fixtures = join(__dirname, '/fixtures');
    nockBack.setMode('lockdown');
}
