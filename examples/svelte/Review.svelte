<script lang="ts">
  import {huddle,type HuddleOptions} from '@huddle/browser/svelte';
  let {options}: {options: HuddleOptions | null} = $props();
</script>
<div use:huddle={options}></div>
