import version from './version.js';
import * as values from './values/index.js';

export { version };
export * from './values/index.js';

export default { version, ...values };
