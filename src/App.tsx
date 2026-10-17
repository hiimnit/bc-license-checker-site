import { useMutation } from "@tanstack/solid-query";
import {
  type ColumnDef,
  createTable,
  FlexRender,
  tableFeatures,
} from "@tanstack/solid-table";
import { For, Match, Show, Switch, type Component } from "solid-js";
import * as z from "zod";
import { saveAs } from "file-saver";

async function readFile(files: FileList | null) {
  if (files == null || files.length === 0) {
    return null;
  }

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(files[0]);
  });
}
async function readFileAsBase64(files: FileList | null) {
  const encoded = await readFile(files);
  if (encoded === null) {
    return null;
  }

  return new Uint8Array(encoded).toBase64();
}
async function readAndTrimLicenseFileAsBase64(files: FileList | null) {
  const encoded = await readFile(files);
  if (encoded === null) {
    return null;
  }

  return trimLicenseFile(encoded).toBase64();
}

function trimLicenseFile(encoded: ArrayBuffer) {
  const decoder = new TextDecoder("windows-1252");
  const decodedText = decoder.decode(encoded);
  const encoder = new TextEncoder();

  const sentinel = "Module Objects and Permissions";
  const i = decodedText.indexOf(sentinel);
  if (i < 0) {
    return encoder.encode(decodedText);
  }
  return encoder.encode(decodedText.substring(0, i + sentinel.length));
}

const objectSchema = z.object({
  type: z.string(),
  id: z.number(),
  name: z.string(),
});
type Object = z.infer<typeof objectSchema>;
const rangeSchema = z.object({
  type: z.string(),
  from: z.number(),
  to: z.number(),
});
type ObjectRange = z.infer<typeof rangeSchema>;
const responseSchema = z.object({
  objects: z.array(objectSchema),
  ranges: z.array(rangeSchema),
});

const App: Component = () => {
  let objectsFile!: HTMLInputElement, licenseFile!: HTMLInputElement;

  const mutation = useMutation(() => ({
    mutationFn: async () => {
      if (objectsFile.files === null || objectsFile.files.length === 0) {
        throw new Error("Select objects file first");
      }
      const res = await fetch("/api/check", {
        method: "POST",
        body: JSON.stringify({
          objects: await readFileAsBase64(objectsFile.files),
          license: await readAndTrimLicenseFileAsBase64(licenseFile.files),
        }),
      });
      if (!res.ok) {
        throw new Error(`Status: ${res.status} ${await res.text()}`);
      }
      return responseSchema.parse(await res.json());
    },
  }));

  function createCsv(ranges: ObjectRange[]) {
    const lines = [
      "ObjectType,FromObjectID,ToObjectID,Read,Insert,Modify,Delete,Execute,AvailableRange,Used,ObjectTypeRemaining,CompanyObjectPermissionID\n",
    ];

    for (const range of ranges) {
      const line = [
        range.type,
        range.from.toString(),
        range.to.toString(),
        "Direct",
        "Direct",
        "Direct",
        "Direct",
        "Direct",
        "50000 - 99999",
        (range.to - range.from + 1).toString(),
        "0",
        "0\n",
      ].join(",");
      lines.push(line);
    }

    const blob = new Blob(lines, {
      type: "text/plain;charset=utf-8",
    });
    saveAs(blob, "missing-objects.csv");
  }

  return (
    <div class="max-w-3xl m-auto space-y-2 py-2">
      <h1 class="text-xl text-mist-200 font-heading px-2">bc license diff</h1>
      <div class="bg-mist-900 p-4 border-mist-800 border-t border-b">
        <div class="space-y-2">
          <div class="flex flex-col md:flex-row gap-2">
            <FileInput
              id="object-file-input"
              label="objects file (.xlsx)"
              ref={objectsFile}
            />
            <FileInput
              id="license-file-input"
              label="license file (.txt)"
              ref={licenseFile}
            />
          </div>
          <div class="flex flex-row justify-between">
            <Button onClick={() => mutation.mutate()}>submit</Button>
            <Button
              onClick={() => {
                mutation.reset();
                objectsFile.value = "";
                licenseFile.value = "";
              }}
            >
              reset
            </Button>
          </div>
        </div>
      </div>
      <Show when={mutation.isError}>
        <div class="bg-mist-900 p-4 border-mist-800 border-t border-b">
          <div class="font-heading text-mist-300">Error</div>
          <span class="font-sans text-mist-400 text-sm">
            {String(mutation.error?.message)}
          </span>
        </div>
      </Show>
      <Show when={mutation.isSuccess || mutation.isPending}>
        <div class="bg-mist-900 p-4 border-mist-800 border-t border-b">
          <div class="font-heading text-mist-300">Missing objects</div>
          <Switch>
            <Match when={mutation.isPending}>
              <span class="font-sans text-mist-400 text-sm italic">
                Loading
              </span>
            </Match>
            <Match
              when={mutation.isSuccess && mutation.data!.objects.length === 0}
            >
              <span class="font-sans text-mist-400 text-sm">
                No missing objects found
              </span>
            </Match>
            <Match
              when={mutation.isSuccess && mutation.data!.objects.length > 0}
            >
              <div class="flex flex-col sm:flex-row gap-2 sm:justify-between">
                <span class="font-sans text-mist-400 text-sm">
                  Identified {mutation.data!.objects.length} missing objects
                </span>
                <Button onClick={() => createCsv(mutation.data!.ranges)}>
                  download .csv
                </Button>
              </div>
              <div class="overflow-auto">
                <ObjectsTable objects={mutation.data!.objects} />
              </div>
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
};

function FileInput({
  id,
  label,
  ref,
}: {
  id: string;
  label: string;
  ref: HTMLInputElement;
}) {
  return (
    <div class="flex flex-col gap-1 w-full">
      <label for={id} class="text-mist-500 font-heading text-xs">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        type="file"
        class="file:text-mist-400 text-mist-400 outline-none file:inline-flex file:bg-transparent border-mist-800 focus-visible:border-mist-400 focus-visible:ring-mist-200/50 border-b border-t px-3 py-1 transition-colors file:h-7 file:text-sm file:font-medium focus-visible:ring-[3px] text-sm"
      />
    </div>
  );
}

function Button({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      class="block text-mist-300 transition-colors bg-mist-900 hover:bg-mist-800/90 font-heading border-b border-t border-mist-800 outline-none focus-visible:ring-mist-200/50 focus-visible:ring-[3px] px-3 py-1 cursor-pointer text-sm"
    >
      {children}
    </button>
  );
}

const features = tableFeatures({});

const columns: Array<ColumnDef<typeof features, Object>> = [
  {
    accessorKey: "type",
    header: "Type",
  },
  {
    accessorKey: "id",
    header: "Id",
  },
  {
    accessorKey: "name",
    header: "Name",
  },
];

function ObjectsTable({ objects }: { objects: Object[] }) {
  const table = createTable({
    key: "objects-table",
    features,
    columns,
    data: objects,
  });

  return (
    <table class="font-sans text-mist-200 w-full text-sm">
      <thead class="border-b border-mist-800">
        <For each={table.getHeaderGroups()}>
          {(headerGroup) => (
            <tr>
              <For each={headerGroup.headers}>
                {(header) => (
                  <th class="font-heading text-mist-300 px-3 h-8 text-left align-middle font-medium whitespace-nowrap">
                    {header.isPlaceholder ? null : (
                      <FlexRender header={header} />
                    )}
                  </th>
                )}
              </For>
            </tr>
          )}
        </For>
      </thead>
      <tbody>
        <For each={table.getRowModel().rows}>
          {(row) => (
            <tr>
              <For each={row.getAllCells()}>
                {(cell) => (
                  <td class="px-3 py-1 align-middle whitespace-nowrap">
                    <FlexRender cell={cell} />
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

export default App;
