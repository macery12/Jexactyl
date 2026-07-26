# Payment hardening migration instructions

Put the Panel into maintenance mode, run the migrations, and bring it back:

```bash
php artisan down
php artisan migrate --force
php artisan up
```

No additional environment variable or migration acknowledgement is required.

The migrations check for duplicate provider identifiers, duplicate
order transactions, duplicate coupon usage, and duplicate ownership of the
same free product. If one of those real data conflicts exists, the migration
stops with a specific message so the conflicting rows can be corrected before
running `php artisan migrate --force` again.
