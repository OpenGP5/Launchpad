/* gp5_storage_claim() (platform gp5_files.c + gp5_store.c) on a RAM flash: same firmware keeps its data, no mark keeps
 * it (and marks it), another firmware's mark wipes the whole area. Prints OK or the failing step. */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
static uint8_t flash[0x200000];
#define STORE_BYTE(off) (flash[0x160000u + (off)])
#define STORE_WORD(off) (*(const uint32_t *)&flash[0x160000u + (off)])
#define FILE_BYTE(a) (flash[(a)])
#define FILE_WORD(a) (*(const uint32_t *)&flash[(a)])
#define FILE_PTR(a)  ((const uint8_t *)&flash[(a)])
int gp5_flash_erase(uint32_t addr) { memset(flash + addr, 0xFF, 0x1000); return 0; }
int gp5_flash_program(uint32_t addr, const uint32_t *src, unsigned len) { unsigned i; for (i = 0; i < len; i++) flash[addr + i] &= ((const uint8_t *)src)[i]; return 0; }
static const char *name = "nam";
const char *fw_name(void) { return name; }
#include "gp5_store.c"                  /* the platform's own (-I its nds32 folder) */
#include "gp5_files.c"                  /* the platform's own (-I its nds32 folder) */
static int used(void) { unsigned a; for (a = 0x13F000; a < 0x18A000; a++) if (a < 0x160000 || a >= 0x162000) if (flash[a] != 0xFF) return 1; return 0; }
int main(void)
{
    memset(flash, 0xFF, sizeof flash);
    flash[0x170000] = 7; flash[0x13F010] = 1;            /* data from before 0.5, no mark */
    gp5_store_save(0x42504D41u, "x", 1);
    gp5_storage_claim();
    if (!used() || !gp5_store_load(0x42504D41u, 0, 0)) { puts("no mark: data must be kept"); return 1; }
    gp5_storage_claim();                                 /* same firmware again */
    if (!used()) { puts("same firmware: data must be kept"); return 1; }
    name = "dreamcatcher";                               /* another firmware */
    gp5_storage_claim();
    if (used() || gp5_store_load(0x42504D41u, 0, 0)) { puts("another firmware: area must be wiped"); return 1; }
    { char m[32]; unsigned n = gp5_store_load(0x4F355047u, m, sizeof m); if (n != 12 || memcmp(m, "dreamcatcher", 12)) { puts("mark not written"); return 1; } }
    puts("OK");
    return 0;
}
