/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useState, useEffect, useContext } from "react";
import { Card, Select, Typography, Avatar } from "@douyinfe/semi-ui";
import { Languages, Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import { API, showSuccess, showError } from "../../../../helpers";
import { UserContext } from "../../../../context/User";
import { normalizeLanguage } from "../../../../i18n/language";

// Language options with native names
const languageOptions = [
	{ value: "zh-CN", label: "简体中文" },
	{ value: "zh-TW", label: "繁體中文" },
	{ value: "en", label: "English" },
	{ value: 'fr', label: 'Français'},
	{ value: 'ru', label: 'Русский'},
	{ value: 'ja', label: '日本語'},
	{ value: "vi", label: "Tiếng Việt" },
];

// 读取管理员预设的展示货币列表
const getCustomCurrencies = () => {
	try {
		const statusStr = localStorage.getItem("status");
		if (!statusStr) return [];
		const s = JSON.parse(statusStr);
		const list = s?.custom_currencies;
		if (!Array.isArray(list)) return [];
		return list.filter((c) => c && c.key && c.symbol);
	} catch (e) {
		return [];
	}
};

const PreferencesSettings = ({ t }) => {
	const { i18n } = useTranslation();
	const [userState, userDispatch] = useContext(UserContext);
	const [currentLanguage, setCurrentLanguage] = useState(
		normalizeLanguage(i18n.language) || "zh-CN",
	);
	const [loading, setLoading] = useState(false);
	const [currentCurrency, setCurrentCurrency] = useState("");
	const [customCurrencies, setCustomCurrencies] = useState(
		getCustomCurrencies,
	);

	// Load saved language preference from user settings
	useEffect(() => {
		if (userState?.user?.setting) {
			try {
				const settings = JSON.parse(userState.user.setting);
				if (settings.language) {
					const lang = normalizeLanguage(settings.language);
					setCurrentLanguage(lang);
					// Sync i18n with saved preference
					if (i18n.language !== lang) {
						i18n.changeLanguage(lang);
					}
				}
			} catch (e) {
				// Ignore parse errors
			}
		}
	}, [userState?.user?.setting, i18n]);

	// Load saved display currency preference
	useEffect(() => {
		if (userState?.user?.setting) {
			try {
				const settings = JSON.parse(userState.user.setting);
				setCurrentCurrency(settings.display_currency || "");
			} catch (e) {
				// Ignore parse errors
			}
		}
	}, [userState?.user?.setting]);

	const handleLanguagePreferenceChange = async (lang) => {
		if (lang === currentLanguage) return;

		setLoading(true);
		const previousLang = currentLanguage;

		try {
			// Update language immediately for responsive UX
			setCurrentLanguage(lang);
			i18n.changeLanguage(lang);
			localStorage.setItem('i18nextLng', lang);

			// Save to backend
			const res = await API.put("/api/user/self", {
				language: lang,
			});

			if (res.data.success) {
				showSuccess(t("语言偏好已保存"));
				// Keep backend preference, context state, and local cache aligned.
				let settings = {};
				if (userState?.user?.setting) {
					try {
						settings = JSON.parse(userState.user.setting) || {};
					} catch (e) {
						settings = {};
					}
				}
				settings.language = lang;
				const nextUser = {
					...userState.user,
					setting: JSON.stringify(settings),
				};
				userDispatch({
					type: "login",
					payload: nextUser,
				});
				localStorage.setItem("user", JSON.stringify(nextUser));
			} else {
				showError(res.data.message || t("保存失败"));
				// Revert on error
				setCurrentLanguage(previousLang);
				i18n.changeLanguage(previousLang);
				localStorage.setItem('i18nextLng', previousLang);
			}
		} catch (error) {
			showError(t("保存失败，请重试"));
			// Revert on error
			setCurrentLanguage(previousLang);
			i18n.changeLanguage(previousLang);
			localStorage.setItem('i18nextLng', previousLang);
		} finally {
			setLoading(false);
		}
	};

	const handleCurrencyPreferenceChange = async (key) => {
		if (key === currentCurrency) return;

		setLoading(true);
		const previousCurrency = currentCurrency;

		try {
			setCurrentCurrency(key);

			// Save to backend (仅能选择管理员预设的货币)
			const res = await API.put("/api/user/self", {
				display_currency: key,
			});

			if (res.data.success) {
				showSuccess(t("展示货币已保存，即将刷新页面"));
				// 同步 user setting 到上下文与本地缓存
				let settings = {};
				if (userState?.user?.setting) {
					try {
						settings = JSON.parse(userState.user.setting) || {};
					} catch (e) {
						settings = {};
					}
				}
				settings.display_currency = key;
				const nextUser = {
					...userState.user,
					setting: JSON.stringify(settings),
				};
				userDispatch({
					type: "login",
					payload: nextUser,
				});
				localStorage.setItem("user", JSON.stringify(nextUser));
				// 渲染函数直读此键；刷新页面确保所有已渲染的金额同步生效
				setTimeout(() => window.location.reload(), 800);
			} else {
				showError(res.data.message || t("保存失败"));
				setCurrentCurrency(previousCurrency);
			}
		} catch (error) {
			showError(t("保存失败，请重试"));
			setCurrentCurrency(previousCurrency);
		} finally {
			setLoading(false);
		}
	};

	const currencyOptions = [
		{ value: "", label: t("跟随站点默认") },
		...customCurrencies.map((c) => ({
			value: c.key,
			label: `${c.name || c.key} (${c.symbol})`,
		})),
	];

	return (
		<Card className="!rounded-2xl shadow-sm border-0">
			{/* Card Header */}
			<div className="flex items-center mb-4">
				<Avatar size="small" color="violet" className="mr-3 shadow-md">
					<Languages size={16} />
				</Avatar>
				<div>
					<Typography.Text className="text-lg font-medium">
						{t("偏好设置")}
					</Typography.Text>
					<div className="text-xs text-gray-600 dark:text-gray-400">
						{t("界面语言和其他个人偏好")}
					</div>
				</div>
			</div>
			{/* Language Setting Card */}
			<Card className="!rounded-xl border dark:border-gray-700">
				<div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4">
					<div className="flex items-start w-full sm:w-auto">
						<div className="w-12 h-12 rounded-full bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center mr-4 flex-shrink-0">
							<Languages
								size={20}
								className="text-violet-600 dark:text-violet-400"
							/>
						</div>
						<div>
							<Typography.Title heading={6} className="mb-1">
								{t("语言偏好")}
							</Typography.Title>
							<Typography.Text type="tertiary" className="text-sm">
								{t("选择您的首选界面语言，设置将自动保存并同步到所有设备")}
							</Typography.Text>
						</div>
					</div>
					<Select
						value={currentLanguage}
						onChange={handleLanguagePreferenceChange}
						style={{ width: 180 }}
						loading={loading}
						optionList={languageOptions.map((opt) => ({
							value: opt.value,
							label: opt.label,
						}))}
					/>
				</div>
			</Card>

			{/* Display Currency Setting Card（管理员未配置预设货币时不显示） */}
			{customCurrencies.length > 0 && (
				<Card className="!rounded-xl border dark:border-gray-700 mt-4">
					<div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4">
						<div className="flex items-start w-full sm:w-auto">
							<div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center mr-4 flex-shrink-0">
								<Coins
									size={20}
									className="text-amber-600 dark:text-amber-400"
								/>
							</div>
							<div>
								<Typography.Title heading={6} className="mb-1">
									{t("展示货币")}
								</Typography.Title>
								<Typography.Text type="tertiary" className="text-sm">
									{t("选择余额和账单使用的展示货币，仅支持管理员预设的货币")}
								</Typography.Text>
							</div>
						</div>
						<Select
							value={currentCurrency}
							onChange={handleCurrencyPreferenceChange}
							style={{ width: 180 }}
							loading={loading}
							optionList={currencyOptions}
						/>
					</div>
				</Card>
			)}

			{/* Additional info */}
			<div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
				<Typography.Text type="tertiary">
					{t(
						"提示：语言偏好会同步到您登录的所有设备，并影响API返回的错误消息语言。",
					)}
				</Typography.Text>
			</div>
		</Card>
	);
};

export default PreferencesSettings;
