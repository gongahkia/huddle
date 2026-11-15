<script setup lang="ts">
import {computed} from 'vue';
import {useHuddle,type HuddleOptions} from '@huddle/browser/vue';
import {createLocalOptions} from '@huddle/browser/local';
import {createHttpAdapter} from '@huddle/browser/http';
const adapter = createHttpAdapter();
const route = useRoute(), enabled = useState('huddle-enabled',() => true), environment = useState('huddle-environment',() => 'staging'), release = useState('huddle-release',() => 'nuxt-example-v1');
const local=createLocalOptions({namespace:'nuxt-example',workspace:typeof route.query.workspace==='string'?route.query.workspace:'personal',environment:'staging'});
const options = computed<HuddleOptions | null>(() => route.path === '/' && typeof route.query.workspace === 'string' && enabled.value ? route.query.mode==='local'?{...local,environment:environment.value,release:release.value}: {adapter,namespace: 'nuxt-example',workspace: route.query.workspace,environment: environment.value,release: release.value} : null);
useHuddle(options);
</script>
<template><NuxtPage /></template>
