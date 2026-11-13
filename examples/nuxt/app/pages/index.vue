<script setup lang="ts">
import {ref} from 'vue';
const route = useRoute(), count = ref(0), enabled = useState('huddle-enabled',() => true), environment = useState('huddle-environment',() => 'staging'), release = useState('huddle-release',() => 'nuxt-example-v1');
</script>
<template><main :data-server-project="route.query.project"><h1>Nuxt server-rendered integration</h1><section data-huddle-id="nuxt-counter"><p>Updates: {{count}}</p><button @click="count++">Add update</button></section><button @click="enabled = !enabled">{{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}}</button><button @click="release = 'nuxt-example-v2'">Change release</button><button @click="environment = environment === 'staging' ? 'production' : 'staging'">Change environment</button><NuxtLink to="/other">Next page</NuxtLink></main></template>
