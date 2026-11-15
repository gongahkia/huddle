import {mount} from './index';
import {createLocalOptions} from './local';
const script=document.currentScript as HTMLScriptElement|null;
if(script?.hasAttribute('data-local')){
 const run=()=>{try{mount(createLocalOptions({namespace:script.dataset.namespace||'huddle-local',workspace:script.dataset.workspace,environment:script.dataset.environment,release:script.dataset.release,styleNonce:script.nonce||undefined}));}catch(value){console.warn('Local Huddle could not start:',value instanceof Error?value.message:'Invalid local installation.');}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
}
export {mount,createLocalOptions};
