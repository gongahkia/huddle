<script setup lang="ts">
import {computed} from 'vue';
import {useHuddle,type HuddleOptions} from '@huddle/browser/vue';
const route = useRoute(), enabled = useState('huddle-enabled',() => true), environment = useState('huddle-environment',() => 'staging'), release = useState('huddle-release',() => 'nuxt-example-v1');
const options = computed<HuddleOptions | null>(() => route.path === '/' && typeof route.query.project === 'string' && enabled.value ? {serverUrl: typeof route.query.server === 'string' ? route.query.server : 'http://localhost:4310',projectId: route.query.project,environment: environment.value,release: release.value} : null);
useHuddle(options);
</script>
<template><NuxtPage /></template>
