import {createApp,defineComponent,h,ref,type PropType} from 'vue';
import {reviewOptions} from '../integration';
import {useHuddle,type HuddleOptions} from '@huddle/browser/vue';
const Review = defineComponent({props: {options: {type: Object as PropType<HuddleOptions>,required: true}},setup(props) {useHuddle(() => props.options); return () => null;}});
createApp({setup() {
  const count = ref(0), enabled = ref(true), environment = ref('staging'), release = ref('vue-example-v1'), timeout = ref(15000), base = reviewOptions('vue');
  return () => h('main',[h('h1','Vue integration'),h('section',{'data-huddle-id': 'vue-counter'},[h('p',`Updates: ${count.value}`),h('button',{onClick: () => count.value++},'Add update')]),h('button',{onClick: () => {enabled.value = !enabled.value;}},enabled.value ? 'Remove Huddle integration' : 'Mount Huddle integration'),h('button',{onClick: () => {release.value = 'vue-example-v2';}},'Change release'),h('button',{onClick: () => {environment.value = environment.value === 'staging' ? 'production' : 'staging';}},'Change environment'),h('button',{onClick: () => {timeout.value = timeout.value === 15000 ? 14000 : 15000;}},'Change configuration'),enabled.value && base ? h(Review,{options: {...base,environment: environment.value,release: release.value,requestTimeoutMs: timeout.value}}) : null]);
}}).mount('#root');
