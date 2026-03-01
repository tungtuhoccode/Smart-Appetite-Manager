### To preview real-time database updates using the terminal
```bash
while true; do
    clear
    sqlite3 -header -column inventory.db \
      "SELECT id, product_name, quantity, quantity_unit, unit, updated_at
       FROM inventory
       ORDER BY id DESC;"
    sleep 1
  done
```