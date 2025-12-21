import {useEffect, useState} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {Form, redirect, useActionData, useLoaderData} from "react-router";
import {BlockStack, Button, Card, Page, Text, TextField} from "@shopify/polaris";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {parsePositiveInt} from "../utils/validation";
import {CriticalBanner} from "../components/CriticalBanner";
import {SuccessToast} from "../components/SuccessToast";

type LoaderData = {
  defaultLeadDays: number | null;
  flashMessage: {text: string; tone: "success" | "critical"} | null;
};

type ActionData = {ok: true; message: string} | {ok: false; message: string};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";

  const setting = await prisma.shopSetting.findUnique({
    where: {shopId: session.shop},
    select: {defaultLeadDays: true},
  });

  return {
    defaultLeadDays: setting?.defaultLeadDays ?? null,
    flashMessage: flashText ? {text: flashText, tone: flashTone} : null,
  } satisfies LoaderData;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const form = await request.formData();
  const rawDays = form.get("defaultLeadDays");
  const parsedDays = parsePositiveInt(rawDays);

  if (!parsedDays) {
    return {
      ok: false,
      message: "全体設定の出荷リードタイムは1以上の整数で入力してください",
    } satisfies ActionData;
  }

  await prisma.shopSetting.upsert({
    where: {shopId: session.shop},
    create: {shopId: session.shop, defaultLeadDays: parsedDays},
    update: {defaultLeadDays: parsedDays},
  });

  const redirectUrl = host
    ? `/app/settings?host=${encodeURIComponent(host)}&message=${encodeURIComponent("保存しました")}&tone=success`
    : `/app/settings?message=${encodeURIComponent("保存しました")}&tone=success`;

  return redirect(redirectUrl);
};

export default function SettingsPage() {
  const {defaultLeadDays, flashMessage} = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const [leadDays, setLeadDays] = useState(defaultLeadDays ? String(defaultLeadDays) : "");
  const isFormReady = parsePositiveInt(leadDays) != null;
  const bannerText = actionData && !actionData.ok ? actionData.message : flashMessage?.text;
  const bannerTone = actionData && !actionData.ok ? "critical" : flashMessage?.tone ?? "success";
  const successMessage = bannerTone === "success" ? bannerText : null;
  const errorMessage = bannerTone === "critical" ? bannerText : null;

  useEffect(() => {
    setLeadDays(defaultLeadDays ? String(defaultLeadDays) : "");
  }, [defaultLeadDays]);

  return (
    <Form method="post">
      <Page
        title="全体設定"
        primaryAction={
          <Button submit variant="primary" disabled={!isFormReady}>
            保存
          </Button>
        }
      >
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            配送エリアにルールがない場合に使用される基準日数を設定します。
          </Text>
          <SuccessToast message={successMessage} />
          <CriticalBanner message={errorMessage} />
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                出荷リードタイム（必須）
              </Text>
              <TextField
                label="出荷リードタイム（日）"
                name="defaultLeadDays"
                type="number"
                min={1}
                requiredIndicator
                autoComplete="off"
                value={leadDays}
                onChange={setLeadDays}
                suffix="日"
                helpText="配送エリアにルールが設定されていない場合、この日数が適用されます。"
                error={actionData && !actionData.ok ? actionData.message : undefined}
              />
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    </Form>
  );
}
