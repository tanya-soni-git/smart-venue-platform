# SmartVenue Platform

## Run locally

1. Create a PostgreSQL database named `smart_venue_db`.
2. Update `backend/.env` with the PostgreSQL password.
3. In `backend`, run `npm install`, `npx prisma generate`, `npx prisma migrate dev --name init`, then `npm start`.
4. In `frontend`, run `npm install`, then `npm run dev`.
5. Open http://localhost:3000.

The first registered account is a Customer. For privileged workflows, update the user's `role` in PostgreSQL to `Admin`, `Organizer`, `GateStaff`, or `Finance`.
