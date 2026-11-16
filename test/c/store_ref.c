/* The platform's real gp5_store.c on a RAM store, driven from stdin: lines "id len seed" -> one save each;
 * at the end the 8 KB image goes to stdout. For test/store.test.mjs (JavaScript writes must match). */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
static uint8_t flash[0x2000];
#define STORE_BYTE(off) (flash[(off)])
#define STORE_WORD(off) (*(const uint32_t *)&flash[(off)])
int gp5_flash_erase(uint32_t addr);
int gp5_flash_program(uint32_t addr, const uint32_t *src, unsigned len);
#include "gp5_store.c"                  /* the platform's own (-I its nds32 folder) */
int gp5_flash_erase(uint32_t addr) { memset(flash + (addr - GP5_FLASH_STORE), 0xFF, GP5_FLASH_SECTOR); return 0; }
int gp5_flash_program(uint32_t addr, const uint32_t *src, unsigned len)
{ unsigned i, off = addr - GP5_FLASH_STORE; for (i = 0; i < len; i++) flash[off + i] &= ((const uint8_t *)src)[i]; return 0; }
int main(void)
{
    unsigned id, len, seed, i; uint8_t d[1024];
    memset(flash, 0xFF, sizeof flash);
    while (scanf("%u %u %u", &id, &len, &seed) == 3) {
        for (i = 0; i < len; i++) { seed = seed * 1103515245u + 12345u; d[i] = (uint8_t)(seed >> 16); }
        if (gp5_store_save(id, d, len)) { fprintf(stderr, "save failed\n"); return 1; }
    }
    fwrite(flash, 1, sizeof flash, stdout);
    return 0;
}
