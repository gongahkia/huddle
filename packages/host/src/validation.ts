import {createValidation} from '../../shared/src/store/validation';
import {nodeRuntime} from './runtime';
export {scopeSchema,identitySchema,listSchema,detailSchema,validate,canonical} from '../../shared/src/store/validation';
export const {digest,encodeCursor,decodeCursor}=createValidation(nodeRuntime);
