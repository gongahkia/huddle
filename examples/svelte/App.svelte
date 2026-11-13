<script lang="ts">
  import Review from './Review.svelte';
  let count = $state(0), enabled = $state(true);
</script>
<main><h1>Svelte integration</h1><section data-huddle-id="svelte-counter"><p>Updates: {count}</p><button onclick={() => count++}>Add update</button></section><button onclick={() => enabled = !enabled}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button>{#if enabled}<Review />{/if}</main>
