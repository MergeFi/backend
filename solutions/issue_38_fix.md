## TL;DR  
Add a **JWT guard** to every money‑moving controller (or to the whole app) so that only an authenticated user can call `fund`, `claim`, `release`, `refund`, `split`, `deposit`, etc.

```ts
// src/escrow/escrow.controller.ts
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
@UseGuards(JwtAuthGuard)          // <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑ <‑‑