/* The platform's real gp5_files.c over an image of the storage area (stdin: bytes 0x13F000 .. 0x189FFF):
 * for each owner id on the command line, list its files: "owner name len crc-ok". For test/files.test.mjs. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
static uint8_t area[0x4B000];
#define AREA_BASE 0x13F000u
#define FILE_BYTE(a) (area[(a) - AREA_BASE])
#define FILE_WORD(a) (*(const uint32_t *)&area[(a) - AREA_BASE])
#define FILE_PTR(a)  ((const uint8_t *)&area[(a) - AREA_BASE])
const char *fw_name(void) { return "test"; }
unsigned gp5_store_load(uint32_t id, void *dst, unsigned max) { (void)id; (void)dst; (void)max; return 0; }
int gp5_store_save(uint32_t id, const void *src, unsigned len) { (void)id; (void)src; (void)len; return 0; }
int gp5_flash_erase(uint32_t addr) { (void)addr; return 0; }
#include "gp5_files.c"                  /* the platform's own (-I its nds32 folder) */
static uint32_t cur;
static void show(const char *name, const uint8_t *data, uint32_t len, void *ctx)
{
    (void)ctx; (void)data;
    printf("%u %s %u %d\n", cur, name, len, gp5_file_check(cur, name));
}
int main(int argc, char **argv)
{
    int i;
    if (fread(area, 1, sizeof area, stdin) != sizeof area) return 2;
    for (i = 1; i < argc; i++) { cur = (uint32_t)strtoul(argv[i], 0, 0); gp5_file_each(cur, show, 0); }
    return 0;
}
