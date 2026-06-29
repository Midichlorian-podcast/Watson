# PriorityBadge

Nebarevný odznak priority úkolu **P1–P4**. Jedno z tvrdých pravidel Watsona (**R6**): **barva ≠ priorita**.

## Kdy použít
- Na kartě úkolu, v detailu úkolu, v seznamech — kdekoli se ukazuje priorita.

## Pravidla
- **Nikdy nebarevný podle priority.** Žádná červená/oranžová „urgence". P1 smí nést jen *mírně* víc důrazu (tmavší ink/linka), ne barvu.
- Uživatelská barva úkolu/projektu/štítku je **oddělený** vizuální prvek (např. `w-task-card__dot`) — nepleť ji s prioritou.
- P1 = akutní (nejvyšší), P4 = budoucnost (default/nejnižší).

## Props
| Prop | Typ | Pozn. |
|---|---|---|
| `priority` | `1 \| 2 \| 3 \| 4` | povinné |
| `className` | `string` | volitelné |

## Příklad
```jsx
<PriorityBadge priority={1} />
<PriorityBadge priority={3} />
```

Render: `<span class="w-priority-badge" data-priority="1">P1</span>` — styl viz `components.css`.
