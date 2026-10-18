"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { chartColors, EmptyChart } from "@/components/ui/chart-utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const BUTTON_VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const BUTTON_SIZES = ["default", "lg", "xl", "icon", "icon-lg"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline", "ghost", "link", "editorial"] as const;
const TAB_VARIANTS = ["default", "line", "editorial"] as const;
const SWITCH_SIZES = ["default", "sm"] as const;
const AVATAR_SIZES = ["default", "sm", "lg"] as const;
const EDITORIAL = "editorial" as const;

const SIZE_LABEL = {
  default: "default",
  lg: "large",
  xl: "extraLarge",
  icon: "icon",
  "icon-lg": "iconLarge",
} as const;

function GallerySection({ scheme }: { scheme: "light" | "dark" }) {
  const t = useTranslations("uiGallery");
  const id = (name: string) => `${scheme}-${name}`;

  return (
    <section
      data-gallery-scheme={scheme}
      className={cn(scheme, "space-y-8 bg-background px-4 py-8 text-foreground")}
    >
      <h2 className="text-2xl">{t(scheme)}</h2>

      <div className="space-y-3">
        <h3 className="text-lg">{t("buttons")}</h3>
        <div className="flex flex-wrap items-center gap-3">
          {BUTTON_VARIANTS.flatMap((variant) =>
            BUTTON_SIZES.map((size) => (
              <Button key={`${variant}-${size}`} variant={variant} size={size} aria-label={t(SIZE_LABEL[size])}>
                {size === "icon" || size === "icon-lg" ? <Plus /> : t(variant)}
              </Button>
            )),
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg">{t("badges")}</h3>
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {t(variant === "editorial" ? "default" : variant)}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg">{t("fields")}</h3>
        <div className="grid max-w-md gap-4">
          <div className="space-y-2">
            <Label htmlFor={id("name")}>{t("name")}</Label>
            <Input id={id("name")} />
          </div>
          <Field htmlFor={id("field")} label={t("name")}>
            <Field.Input id={id("field")} />
          </Field>
          <div className="space-y-2">
            <Label htmlFor={id("notes")}>{t("notes")}</Label>
            <Textarea id={id("notes")} />
          </div>
          <Field htmlFor={id("field-notes")} label={t("notes")}>
            <Field.Textarea id={id("field-notes")} />
          </Field>
          <div className="space-y-2">
            <Label htmlFor={id("service")}>{t("service")}</Label>
            <NativeSelect id={id("service")} className="min-w-11" defaultValue="cut">
              <option value="cut">{t("service")}</option>
            </NativeSelect>
          </div>
          <Select defaultValue="cut">
            <SelectTrigger className="min-w-11" aria-label={t("service")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cut">{t("service")}</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="cut">
            <Field label={t("service")}>
              <Field.Select className="min-w-11" aria-label={t("service")}>
                <SelectValue />
              </Field.Select>
            </Field>
            <SelectContent>
              <SelectItem value="cut">{t("service")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg">{t("choices")}</h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id={id("checked")} defaultChecked aria-label={t("checked")} />
            <Label htmlFor={id("checked")}>{t("checked")}</Label>
          </div>
          {SWITCH_SIZES.map((size) => (
            <div key={size} className="flex items-center gap-2">
              <Switch id={id(`on-${size}`)} size={size} defaultChecked aria-label={t("on")} />
              <Label htmlFor={id(`on-${size}`)}>{t("on")}</Label>
            </div>
          ))}
        </div>
        <Slider
          defaultValue={[40]}
          thumbLabels={[t("sliderValue")]}
          className="max-w-sm"
        />
        {TAB_VARIANTS.map((variant) => (
          <Tabs key={variant} defaultValue="one">
            <TabsList variant={variant}>
              <TabsTrigger value="one">{t("default")}</TabsTrigger>
              <TabsTrigger value="two">{t("outline")}</TabsTrigger>
            </TabsList>
            <TabsContent value="one">{t("content")}</TabsContent>
          </Tabs>
        ))}
      </div>

      <div className="space-y-3">
        <h3 className="text-lg">{t("overlays")}</h3>
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{t("open")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("overlays")}</DialogTitle>
                <DialogDescription>{t("notes")}</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">{t("open")}</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{t("overlays")}</SheetTitle>
                <SheetDescription>{t("notes")}</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline">{t("open")}</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{t("overlays")}</DrawerTitle>
                <DrawerDescription>{t("notes")}</DrawerDescription>
              </DrawerHeader>
            </DrawerContent>
          </Drawer>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">{t("open")}</Button>
            </PopoverTrigger>
            <PopoverContent>{t("notes")}</PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">{t("open")}</Button>
            </TooltipTrigger>
            <TooltipContent>{t("notes")}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">{t("menu")}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t("menu")}</DropdownMenuLabel>
              <DropdownMenuItem>{t("default")}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">{t("destructive")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked>{t("checked")}</DropdownMenuCheckboxItem>
              <DropdownMenuRadioGroup value="one">
                <DropdownMenuRadioItem value="one">{t("on")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg">{t("search")}</h3>
        <Command className="max-w-md rounded-md border">
          <CommandInput placeholder={t("search")} aria-label={t("search")} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            <CommandGroup>
              <CommandItem>{t("service")}</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg">{t("content")}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("default")}</CardTitle>
              <CardDescription>{t("notes")}</CardDescription>
            </CardHeader>
            <CardContent>{t("content")}</CardContent>
            <CardFooter>
              <Button>{t("open")}</Button>
            </CardFooter>
          </Card>
          <Card variant={EDITORIAL}>
            <CardHeader>
              <CardTitle>{t("outline")}</CardTitle>
              <CardDescription>{t("notes")}</CardDescription>
            </CardHeader>
            <CardContent>{t("content")}</CardContent>
          </Card>
        </div>
        <div className="flex items-center gap-3">
          <AvatarGroup>
            {AVATAR_SIZES.map((size) => (
              <Avatar key={size} size={size}>
                <AvatarFallback>AB</AvatarFallback>
                <AvatarBadge />
              </Avatar>
            ))}
            <AvatarGroupCount>+2</AvatarGroupCount>
          </AvatarGroup>
        </div>
        <Separator />
        <div className="flex h-11 items-center">
          <Separator orientation="vertical" />
        </div>
        <Skeleton className="h-11 w-40" />
        <EmptyChart message={t("empty")} />
        <div className="flex gap-2">
          {chartColors.map((color) => (
            <span key={color} className="size-11 rounded-md" style={{ background: color }} />
          ))}
        </div>
        <Table>
          <TableCaption>{t("content")}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("service")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{t("name")}</TableCell>
              <TableCell>{t("service")}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Calendar mode="single" />
        <SidebarProvider className="h-80 min-h-0">
          <Sidebar collapsible="none" className="h-full">
            <SidebarHeader>
              <SidebarInput aria-label={t("search")} />
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>{t("menu")}</SidebarGroupLabel>
                <SidebarGroupAction aria-label={t("open")}>
                  <Plus />
                </SidebarGroupAction>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive>{t("default")}</SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>{t("outline")}</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
        </SidebarProvider>
        <Toaster theme={scheme} />
      </div>
    </section>
  );
}

export function GalleryBoard() {
  const t = useTranslations("uiGallery");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
      <h1 className="text-3xl">{t("title")}</h1>
      <GallerySection scheme="light" />
      <GallerySection scheme="dark" />
    </div>
  );
}
