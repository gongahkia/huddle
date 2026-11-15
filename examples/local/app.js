import {mount} from '../sdk/huddle.js';
import {createLocalOptions} from '../sdk/local.js';
const namespace=new URLSearchParams(location.search).get('namespace')||'local-example';
const options=createLocalOptions({namespace,release:'local-example'});
let review=mount(options),updates=0;
window.localExample={options,get review(){return review;}};
document.querySelector('#toggle-review').addEventListener('click',event=>{if(review){review.destroy();review=undefined;event.currentTarget.textContent='Attach Huddle';}else{review=mount(options);event.currentTarget.textContent='Detach Huddle';}});
document.querySelector('#add-update').addEventListener('click',()=>{document.querySelector('#updates').textContent=++updates+' updates';});
