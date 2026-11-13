<script lang="ts">
  import Review from './Review.svelte';
  import {reviewOptions} from '../integration';
  const base = reviewOptions('svelte');
  let count = $state(0), enabled = $state(true), environment = $state('staging'), release = $state('svelte-example-v1'), timeout = $state(15000);
</script>
<main><h1>Svelte integration</h1><section data-huddle-id="svelte-counter"><p>Updates: {count}</p><button onclick={() => count++}>Add update</button></section><button onclick={() => enabled = !enabled}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><button onclick={() => release = 'svelte-example-v2'}>Change release</button><button onclick={() => environment = environment === 'staging' ? 'production' : 'staging'}>Change environment</button><button onclick={() => timeout = timeout === 15000 ? 14000 : 15000}>Change configuration</button>{#if enabled}<Review options={base ? {...base,environment,release,requestTimeoutMs: timeout} : null} />{/if}</main>
