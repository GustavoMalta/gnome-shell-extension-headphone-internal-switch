/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'my-indicator-extension';

const { GObject, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const _ = ExtensionUtils.gettext;

const Gio = imports.gi.Gio;

const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;


function hasHeadphoneActive() {
    try {

        let [ok, out, err, exit] = GLib.spawn_command_line_sync(
            'amixer -c0 get Headphone'
        );

        if (ok) {
            return ByteArray.toString(out).includes('[on]')
        }

        throw Error(err)

    } catch (e) {
        logError(e, 'Erro ao executar amixer');
        return false;
    }
}

function watchAudioEvents(callback) {
    let lastStatus = null;

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        let currentStatus = hasHeadphoneActive();

        if (currentStatus !== lastStatus) {
            lastStatus = currentStatus;
            callback(currentStatus);
        }
        console.log("currentStatus", currentStatus)
        return true;
    });
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, _('My Shiny Indicator'));

            const internalIcon = new St.Icon({
                icon_name: 'audio-speakers-symbolic',
                style_class: 'system-status-icon',
            });

            const headphoneIcon = new St.Icon({
                icon_name: 'audio-headphones-symbolic',
                style_class: 'system-status-icon',
            });


            // selected = hasHeadphoneActive() ? "headphone" : "internal"
            let internal = new PopupMenu.PopupMenuItem(_('Internal Speakers'));
            let headphone = new PopupMenu.PopupMenuItem(_('Headphone'));

            internal.setSensitive(true);
            internal.setOrnament(PopupMenu.Ornament.NONE);
            headphone.setSensitive(false);
            headphone.setOrnament(PopupMenu.Ornament.CHECK);
            this.add_child(headphoneIcon);


            internal.connect('activate', async () => {
                let [ok, out, err, exit] = GLib.spawn_command_line_sync(
                    'amixer -c 0 set "Speaker" on 100'
                );
                if (ok) {
                    internal.setSensitive(false);
                    internal.setOrnament(PopupMenu.Ornament.CHECK);
                    headphone.setSensitive(true);
                    headphone.setOrnament(PopupMenu.Ornament.NONE);
                    this.remove_child(headphoneIcon);
                    this.add_child(internalIcon);
                } else {
                    Main.notify(_('Error activating internal speakers'));
                }
            });

            headphone.connect('activate', () => {
                let [ok, out, err, exit] = GLib.spawn_command_line_sync(
                    'amixer -c 0 set "Speaker" off 0'
                );
                if (ok) {
                    headphone.setSensitive(false);
                    headphone.setOrnament(PopupMenu.Ornament.CHECK);
                    internal.setSensitive(true);
                    internal.setOrnament(PopupMenu.Ornament.NONE);
                    this.remove_child(internalIcon);
                    this.add_child(headphoneIcon);
                } else {
                    Main.notify(_('Error activating headphone'));
                }
            });

            this.menu.addMenuItem(internal);
            this.menu.addMenuItem(headphone);
        }
    });

class Extension {
    constructor(uuid) {
        watchAudioEvents((res) => {
            if (res) {
                if (this._indicator == null) {
                    this._indicator = new Indicator();
                    Main.panel.addToStatusArea(this._uuid, this._indicator);
                }
            } else {
                this._indicator.destroy();
                this._indicator = null;
            }
        })

        this._uuid = uuid;
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        if (hasHeadphoneActive())
            GLib.spawn_command_line_sync(
                'amixer -c 0 set "Speaker" off'
            );
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
