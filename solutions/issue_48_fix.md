**Solution Overview**

`MaintenancePoolService.deposit` always calls `EscrowService.fund`.  
`EscrowService.fund` *creates a new Escrow row* – it never re‑uses an existing one.  
Because of that, every deposit after the first one ends up with a brand‑new, orphaned
Escrow row that is never linked to the pool again, and the reward‑assignment logic
can’t see the funds.

The fix is to **top‑up the existing Escrow** instead of creating a