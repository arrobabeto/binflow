<script setup lang="ts">
import type { TicketSummary } from '@binflow/contracts';
import {
  formatTicketRelativeTime,
  ticketIsUnread,
  ticketStateBadgeColor,
  ticketStateLabel,
} from '../lib/ticket-inbox';

defineProps<{
  item: TicketSummary;
}>();
</script>

<template>
  <div
    class="binflow-surface flex flex-col gap-3 rounded-xl border border-[var(--binflow-border)] p-4 sm:flex-row sm:items-center sm:justify-between"
    :class="
      ticketIsUnread(item)
        ? 'border-l-[3px] border-l-[var(--binflow-accent)]'
        : ''
    "
  >
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="ticketIsUnread(item)"
          class="inline-block size-2 shrink-0 rounded-full bg-[var(--binflow-accent)]"
          aria-label="Unread"
        />
        <p
          class="text-xs font-medium tracking-wide uppercase"
          :class="
            ticketIsUnread(item)
              ? 'text-[var(--binflow-accent)]'
              : 'text-muted'
          "
        >
          {{ item.clientName }}
        </p>
      </div>
      <p class="mt-1 truncate text-base font-semibold text-white">
        {{ item.title }}
      </p>
      <p class="mt-1 line-clamp-2 text-sm text-muted">
        {{ item.excerpt || 'No excerpt' }}
      </p>
      <p class="mt-2 text-xs text-muted">
        {{ formatTicketRelativeTime(item.updatedAt) }}
      </p>
    </div>
    <div class="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
      <UBadge :color="ticketStateBadgeColor(item.state)" variant="soft">
        {{ ticketStateLabel(item.state) }}
      </UBadge>
      <UButton
        :to="`/tickets/${item.id}`"
        color="primary"
        variant="soft"
        size="sm"
      >
        Open ticket
      </UButton>
    </div>
  </div>
</template>
