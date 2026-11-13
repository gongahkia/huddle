import {createApp,defineComponent,h,ref} from 'vue';
import {reviewOptions} from '../integration';
import {useHuddle} from '@huddle/browser/vue';
const Review = defineComponent({setup() {useHuddle(() => reviewOptions('vue')); return () => null;}});
createApp({setup() {
  const count = ref(0), enabled = ref(true);
  return () => h('main',[h('h1','Vue integration'),h('section',{'data-huddle-id': 'vue-counter'},[h('p',`Updates: ${count.value}`),h('button',{onClick: () => count.value++},'Add update')]),h('button',{onClick: () => {enabled.value = !enabled.value;}},enabled.value ? 'Remove Huddle integration' : 'Mount Huddle integration'),enabled.value ? h(Review) : null]);
}}).mount('#root');
