Here’s what each file does, in plain terms.

The project folder: dinnerraise-api

This is your backend, the part of the app that stores data, checks passwords, and decides who can book a seat. Your React website (the part guests and hosts see) will be a separate project and will talk to this one over the internet.

Files you created or edited

package.json is the project’s shopping list and instruction sheet. It names the project, lists the libraries it uses, and holds shortcut commands like npm run dev.

package-lock.json is a receipt. It records the exact version of every library installed, so the project works the same on any computer.

tsconfig.json is the instruction sheet for TypeScript. It tells the translator where your code lives (src/), where to put the translated output (dist/), and how strict to be about mistakes.

.gitignore is a list of things Git should ignore. We told it to skip node_modules (downloaded libraries), dist (translated output), and .env (your secrets).

.env is a private notes file for settings and passwords: the database password, a secret key for login tokens, and the port number. It never goes to Git, so your secrets stay on your computer.

The database: prisma/

prisma/schema.prisma is the blueprint for your database. It describes the three tables in plain language:

User: a person, either a host or a guest, with an email and optional password
Event: a dinner a host creates, with a location, date, price per seat, and number of seats
Seat: a seat a guest books at an event, including their dietary needs

prisma/migrations/ is the history of changes to the database. When we created the tables, Prisma wrote the SQL instructions into a timestamped folder. Keeping this history means any database can be rebuilt the same way.

prisma/migrations/migration_lock.toml is a small technical marker that tells Prisma which database type the migrations are for. You can ignore it.

The code: src/

src/server.ts is where the app starts. It switches the server on, tells you the address in the terminal, and shuts everything down cleanly when you press Ctrl+C.

src/app.ts is the set of rules for how the API responds. Right now it has one rule: when someone visits /health, reply “ok”. Future features (sign-up, booking seats) will be added here.

src/config/env.ts is a safety check. When the app starts, it confirms the secrets in .env exist and look right. If something’s missing, it stops with a clear message instead of failing mysteriously later.

src/lib/prisma.ts creates one shared connection to the database. Every part of the app uses this same connection rather than opening a new one each time.

Files Prisma and npm created for you

node_modules/ holds the downloaded libraries. It’s large and never edited by hand. If it’s ever deleted, npm install rebuilds it.

node_modules/@prisma/client/ (generated) is the database toolkit Prisma wrote from your schema. It gives your code typed functions like prisma.user.create.

//////// Run this to bring up data base /////////
npm run db:studio 

///// Get strip up and running locally ////
stripe listen --events checkout.session.completed --forward-to localhost:4000/webhooks/stripe




# Log in as the host and store the token in $login
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType "application/json" -Body '{"email":"host@example.com","password":"secret123"}'

# Check you are loged in
$login.user

# Build the event details as a PowerShell hashtable, then convert to JSON text
$body = @{ title = "Capacity Test"; location = "4 Test Street, London"; startsAt = "2027-09-01T19:00:00Z"; seatPriceCents = 2500; capacity = 1 } | ConvertTo-Json

# Create the event and keep just the event object (the .event part of the response)
$event = (Invoke-RestMethod -Method Post -Uri http://localhost:4000/events -ContentType "application/json" -Headers @{ Authorization = "Bearer $($login.token)" } -Body $body).event

# Guest one requests a seat
$b1 = @{ guestName = "Jo"; guestEmail = "jo@example.com"; dietaryRestrictions = @() } | ConvertTo-Json
$req1 = Invoke-RestMethod -Method Post -Uri "http://localhost:4000/events/$($event.id)/seats" -ContentType "application/json" -Body $b1

# Guest two requests a seat
$b2 = @{ guestName = "Lee"; guestEmail = "lee@example.com"; dietaryRestrictions = @() } | ConvertTo-Json
$req2 = Invoke-RestMethod -Method Post -Uri "http://localhost:4000/events/$($event.id)/seats" -ContentType "application/json" -Body $b2

# Step 2 check: the public view should show seats remaining
Invoke-RestMethod -Uri "http://localhost:4000/events/$($event.id)" | ConvertTo-Json -Depth 5

# Host approves Jo. Seat moves to AWAITING_PAYMENT
$d = @{ status = "CONFIRMED" } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://localhost:4000/seats/$($req1.seat.id)" -ContentType "application/json" -Headers @{ Authorization = "Bearer $($login.token)" } -Body $d

# Check the public view again: seatsRemaining should now be 0
Invoke-RestMethod -Uri "http://localhost:4000/events/$($event.id)" | ConvertTo-Json -Depth 5


